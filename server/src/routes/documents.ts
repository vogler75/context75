import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import * as db from '../db';
import { parseDocument } from '../services/parser';
import { chunkText } from '../services/chunker';
import { generateEmbedding } from '../services/embedder';

const router = Router();
const upload = multer({ dest: 'uploads/' });

const mapDocument = (row: any) => ({
  id: row.id,
  collectionId: row.collection_id,
  title: row.title,
  filePath: row.file_path,
  fileType: row.file_type,
  fileSizeBytes: parseInt(row.file_size_bytes || '0'),
  chunkCount: parseInt(row.chunkCount || '0'),
  checksum: row.checksum,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * GET /api/collections/:collectionId/documents
 * List all documents inside a specific collection.
 */
router.get('/collections/:collectionId/documents', async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params;
    const result = await db.query(`
      SELECT d.*, 
             COUNT(ch.id) as "chunkCount"
      FROM documents d
      LEFT JOIN document_chunks ch ON ch.document_id = d.id
      WHERE d.collection_id = $1
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `, [collectionId]);

    res.json(result.rows.map(mapDocument));
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list documents", details: error.message });
  }
});

/**
 * GET /api/documents/:id
 * Retrieve details of a single document.
 */
router.get('/documents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db.query(`
      SELECT d.*, 
             COUNT(ch.id) as "chunkCount"
      FROM documents d
      LEFT JOIN document_chunks ch ON ch.document_id = d.id
      WHERE d.id = $1
      GROUP BY d.id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    res.json(mapDocument(result.rows[0]));
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch document", details: error.message });
  }
});

/**
 * DELETE /api/documents/:id
 * Delete a document, its vector chunks, and remove file from local disk.
 */
router.delete('/documents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Fetch file path before deleting
    const docResult = await db.query('SELECT title, file_path FROM documents WHERE id = $1', [id]);
    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    const { title, file_path } = docResult.rows[0];

    // Delete database records (cascades automatically to document_chunks)
    await db.query('DELETE FROM documents WHERE id = $1', [id]);

    // Clean up local disk
    if (file_path && fs.existsSync(file_path)) {
      fs.unlinkSync(file_path);
    }

    res.json({
      success: true,
      message: `Document '${title}' and its associated vector chunks were successfully deleted.`
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to delete document", details: error.message });
  }
});

/**
 * POST /api/collections/:collectionId/upload
 * Upload and vectorize a file (Markdown or PDF) in a PostgreSQL transaction.
 */
router.post('/collections/:collectionId/upload', upload.single('file'), async (req: Request, res: Response) => {
  const { collectionId } = req.params;
  const file = req.file;
  const title = req.body.title;

  if (!file) {
    return res.status(400).json({ error: "No file uploaded. Please upload a file via multipart form-data under key 'file'" });
  }

  const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
  if (fileExtension !== 'md' && fileExtension !== 'pdf' && fileExtension !== 'mdx') {
    // Delete temp file if invalid type
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(400).json({ error: "Unsupported file type. Only Markdown (.md, .mdx) and PDF (.pdf) files are supported." });
  }

  // Check if collection exists
  const collectionCheck = await db.query('SELECT id FROM collections WHERE id = $1', [collectionId]);
  if (collectionCheck.rows.length === 0) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(404).json({ error: "Collection not found" });
  }

  // Calculate file checksum to detect duplicates
  const fileBuffer = fs.readFileSync(file.path);
  const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  try {
    // Check if same file is already uploaded in this collection
    const duplicateResult = await db.query(
      'SELECT id, title FROM documents WHERE collection_id = $1 AND checksum = $2',
      [collectionId, checksum]
    );
    if (duplicateResult.rows.length > 0) {
      // Remove temp file (we won't double-vectorize it)
      fs.unlinkSync(file.path);
      return res.status(409).json({
        error: "Duplicate file detected. This exact document has already been vectorized in this collection.",
        documentId: duplicateResult.rows[0].id,
        title: duplicateResult.rows[0].title
      });
    }

    // 1. Parse File
    const parsedDoc = await parseDocument(file.path, fileExtension);
    const docTitle = title || parsedDoc.title || file.originalname.replace(/\.[^/.]+$/, "");

    // 2. Extract and segment text into chunks
    const allChunks: { content: string; chunkIndex: number; metadata: any }[] = [];
    for (const page of parsedDoc.pages) {
      const pageChunks = chunkText(page.content, 800, 150, page.pageNumber, page.headerPath);
      allChunks.push(...pageChunks);
    }

    if (allChunks.length === 0) {
      throw new Error("No readable text content extracted from document.");
    }

    // 3. Generate Vector Embeddings (Node-native Transformers)
    const embeddings: number[][] = [];
    for (const chunk of allChunks) {
      const embedding = await generateEmbedding(chunk.content);
      embeddings.push(embedding);
    }

    // 4. Save to Database within a transaction
    const pgClient = await db.getClient();
    try {
      await pgClient.query('BEGIN');

      const docInsertResult = await pgClient.query(`
        INSERT INTO documents (collection_id, title, file_path, file_type, raw_content, checksum)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [collectionId, docTitle, file.path, fileExtension, parsedDoc.rawContent, checksum]);

      const insertedDoc = docInsertResult.rows[0];

      // Bulk-insert vector chunks
      for (let i = 0; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        const embedding = embeddings[i];

        await pgClient.query(`
          INSERT INTO document_chunks (document_id, chunk_index, content, embedding, metadata)
          VALUES ($1, $2, $3, $4, $5)
        `, [insertedDoc.id, chunk.chunkIndex, chunk.content, embedding, JSON.stringify(chunk.metadata)]);
      }

      await pgClient.query('COMMIT');

      res.status(201).json({
        message: "File successfully uploaded and vectorized.",
        document: mapDocument({ ...insertedDoc, chunkCount: allChunks.length })
      });

    } catch (transactionError) {
      await pgClient.query('ROLLBACK');
      throw transactionError;
    } finally {
      pgClient.release();
    }

  } catch (error: any) {
    // Delete uploaded temp file on error
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    console.error("Vectorization error:", error);
    res.status(500).json({ error: "Failed to parse and vectorize file", details: error.message });
  }
});

/**
 * GET /api/documents/:id/chunks
 * List all chunk representations and metadata for a specific document (useful for GUI previewing).
 */
router.get('/documents/:id/chunks', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const docResult = await db.query('SELECT id, title FROM documents WHERE id = $1', [id]);
    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    const chunksResult = await db.query(`
      SELECT id, chunk_index as "chunkIndex", content, embedding, metadata
      FROM document_chunks
      WHERE document_id = $1
      ORDER BY chunk_index ASC
    `, [id]);

    const formattedChunks = chunksResult.rows.map(row => {
      // Map vector array floats to a string summary
      const emb = row.embedding || [];
      const embSnippet = `[${emb.slice(0, 5).join(', ')}, ... ${emb.length} total dimensions]`;
      
      return {
        id: row.id,
        chunkIndex: row.chunkIndex,
        content: row.content,
        embeddingSnippet: embSnippet,
        metadata: row.metadata
      };
    });

    res.json({
      documentId: docResult.rows[0].id,
      documentTitle: docResult.rows[0].title,
      chunks: formattedChunks
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to retrieve chunks", details: error.message });
  }
});

export default router;
