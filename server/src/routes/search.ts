import { Router, Request, Response } from 'express';
import * as db from '../db';
import { generateEmbedding } from '../services/embedder';

const router = Router();

/**
 * POST /api/search
 * Perform a semantic vector search across a collection using custom SQL cosine similarity.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { collectionId, query, limit = 5, minSimilarity = 0.5 } = req.body;

    if (!collectionId || !query) {
      return res.status(400).json({ error: "Missing required fields: 'collectionId' and 'query' must be provided in body." });
    }

    // 1. Resolve collectionId in case it was passed as a name slug
    let resolvedCollectionId = collectionId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collectionId);
    
    if (!isUuid) {
      const colCheck = await db.query('SELECT id FROM collections WHERE name = $1', [collectionId]);
      if (colCheck.rows.length === 0) {
        return res.status(404).json({ error: `Collection with slug '${collectionId}' not found.` });
      }
      resolvedCollectionId = colCheck.rows[0].id;
    }

    // 2. Generate embedding for query text (using Xenova/all-MiniLM-L6-v2)
    const queryEmbedding = await generateEmbedding(query);

    // 3. Query PostgreSQL using native pgvector cosine distance operator
    // Note: ch.embedding <=> $1 calculates cosine distance; we subtract it from 1 to get similarity
    const searchResult = await db.query(`
      SELECT ch.id as "chunkId",
             ch.content,
             ch.metadata,
             d.id as "documentId",
             d.title as "documentTitle",
             1 - (ch.embedding <=> $1::vector) as similarity
      FROM document_chunks ch
      JOIN documents d ON d.id = ch.document_id
      WHERE d.collection_id = $2
        AND (1 - (ch.embedding <=> $1::vector)) >= $3
      ORDER BY similarity DESC
      LIMIT $4
    `, [queryEmbedding, resolvedCollectionId, minSimilarity, limit]);

    res.json({
      query,
      collectionId: resolvedCollectionId,
      resultsCount: searchResult.rows.length,
      results: searchResult.rows.map(row => ({
        chunkId: row.chunkId,
        documentId: row.documentId,
        documentTitle: row.documentTitle,
        content: row.content,
        similarity: parseFloat(row.similarity.toFixed(4)),
        metadata: row.metadata
      }))
    });
  } catch (error: any) {
    console.error("Semantic search failed:", error);
    res.status(500).json({ error: "Failed to perform semantic search", details: error.message });
  }
});

export default router;
