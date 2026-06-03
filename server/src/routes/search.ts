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

    // 3. Query PostgreSQL using custom cosine_similarity PL/pgSQL function
    // Note: cosine_similarity is formatted: float similarity = cosine_similarity(embedding_a, embedding_b)
    const searchResult = await db.query(`
      SELECT ch.id as "chunkId",
             ch.content,
             ch.metadata,
             d.id as "documentId",
             d.title as "documentTitle",
             cosine_similarity(ch.embedding, $1) as similarity
      FROM document_chunks ch
      JOIN documents d ON d.id = ch.document_id
      WHERE d.collection_id = $2
        AND cosine_similarity(ch.embedding, $1) >= $3
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
