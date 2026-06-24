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
  status: row.status || 'pending',
  statusMessage: row.status_message || '',
  progressPercent: parseInt(row.progress_percent || '0'),
  totalChunks: parseInt(row.total_chunks || '0'),
  processedChunks: parseInt(row.processed_chunks || '0'),
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
 * Helper to process document parsing and vectorization in the background.
 */
const runBackgroundVectorization = async (docId: string, filePath: string, ext: string) => {
  try {
    // 1. Update status to parsing
    await db.query(`
      UPDATE documents 
      SET status = 'processing', status_message = 'Parsing and extracting text content...'
      WHERE id = $1
    `, [docId]);

    const parsedDoc = await parseDocument(filePath, ext);
    
    // Update raw content and use parsed title if available
    await db.query(`
      UPDATE documents 
      SET raw_content = $1, title = COALESCE(NULLIF($2, ''), title), status_message = 'Segmenting text into chunks...'
      WHERE id = $3
    `, [parsedDoc.rawContent, parsedDoc.title || '', docId]);

    // 2. Chunker
    const allChunks: { content: string; chunkIndex: number; metadata: any }[] = [];
    for (const page of parsedDoc.pages) {
      const pageChunks = chunkText(page.content, 800, 150, page.pageNumber, page.headerPath);
      allChunks.push(...pageChunks);
    }

    if (allChunks.length === 0) {
      throw new Error("No readable text content extracted from document.");
    }

    // Update total chunks count
    await db.query(`
      UPDATE documents 
      SET total_chunks = $1, status_message = 'Generating vector embeddings...'
      WHERE id = $2
    `, [allChunks.length, docId]);

    // 3. Process, embed, and insert chunks sequentially
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      const embedding = await generateEmbedding(chunk.content);
      const embeddingStr = `[${embedding.join(',')}]`;

      await db.query(`
        INSERT INTO document_chunks (document_id, chunk_index, content, embedding, metadata)
        VALUES ($1, $2, $3, $4, $5)
      `, [docId, chunk.chunkIndex, chunk.content, embeddingStr, JSON.stringify(chunk.metadata)]);

      const processed = i + 1;
      const progress = Math.round((processed / allChunks.length) * 100);

      await db.query(`
        UPDATE documents 
        SET processed_chunks = $1, progress_percent = $2, status_message = $3
        WHERE id = $4
      `, [processed, progress, `Vectorized chunk ${processed}/${allChunks.length} (${progress}%)`, docId]);
    }

    // 4. Set final completed status
    await db.query(`
      UPDATE documents 
      SET status = 'completed', status_message = 'Completed successfully.', progress_percent = 100
      WHERE id = $1
    `, [docId]);

  } catch (error: any) {
    console.error(`Background vectorization error for document ${docId}:`, error);

    // Update DB status to failed
    await db.query(`
      UPDATE documents 
      SET status = 'failed', status_message = $1, progress_percent = 0
      WHERE id = $2
    `, [error.message || 'Unknown processing error', docId]);

    // Cleanup local file on failure
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Cleanup of failed file failed:", err);
      }
    }
  }
};

/**
 * POST /api/collections/:collectionId/upload
 * Upload a file (Markdown or PDF) and trigger background vectorization.
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
      fs.unlinkSync(file.path);
      return res.status(409).json({
        error: "Duplicate file detected. This exact document has already been vectorized in this collection.",
        documentId: duplicateResult.rows[0].id,
        title: duplicateResult.rows[0].title
      });
    }

    const docTitle = title || file.originalname.replace(/\.[^/.]+$/, "");

    // Save initial document record as pending
    const docInsertResult = await db.query(`
      INSERT INTO documents (collection_id, title, file_path, file_type, checksum, status, status_message, progress_percent)
      VALUES ($1, $2, $3, $4, $5, 'pending', 'Initializing vectorization task...', 0)
      RETURNING *
    `, [collectionId, docTitle, file.path, fileExtension, checksum]);

    const insertedDoc = docInsertResult.rows[0];

    // Trigger background thread worker loop without awaiting it
    runBackgroundVectorization(insertedDoc.id, file.path, fileExtension).catch(err => {
      console.error(`Unhandled crash inside background vectorization loop for document ${insertedDoc.id}:`, err);
    });

    // Return the response immediately with 202 Accepted status code
    res.status(202).json({
      message: "File successfully uploaded. Vectorization is processing in the background.",
      document: mapDocument({ ...insertedDoc, chunkCount: 0 })
    });

  } catch (error: any) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    console.error("Upload routing initialization error:", error);
    res.status(500).json({ error: "Failed to initialize document upload", details: error.message });
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
      // Map vector array representation to a string summary
      let emb: number[] = [];
      if (typeof row.embedding === 'string') {
        emb = row.embedding.replace(/[\[\]]/g, '').split(',').map(Number);
      } else if (Array.isArray(row.embedding)) {
        emb = row.embedding;
      }
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
