import { Router, Request, Response } from 'express';
import * as db from '../db';

const router = Router();

const mapCollection = (row: any) => ({
  id: row.id,
  name: row.name,
  displayName: row.display_name,
  description: row.description,
  documentCount: parseInt(row.documentCount || '0'),
  chunkCount: parseInt(row.chunkCount || '0'),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * GET /api/collections
 * List all documentation collections with count stats.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT c.*, 
             COUNT(DISTINCT d.id) as "documentCount",
             COUNT(DISTINCT ch.id) as "chunkCount"
      FROM collections c
      LEFT JOIN documents d ON d.collection_id = c.id
      LEFT JOIN document_chunks ch ON ch.document_id = d.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    
    res.json(result.rows.map(mapCollection));
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list collections", details: error.message });
  }
});

/**
 * GET /api/collections/:id
 * Retrieve details for a single collection by ID or name slug.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    const queryStr = isUuid
      ? `SELECT c.*, 
                COUNT(DISTINCT d.id) as "documentCount",
                COUNT(DISTINCT ch.id) as "chunkCount"
         FROM collections c
         LEFT JOIN documents d ON d.collection_id = c.id
         LEFT JOIN document_chunks ch ON ch.document_id = d.id
         WHERE c.id = $1
         GROUP BY c.id`
      : `SELECT c.*, 
                COUNT(DISTINCT d.id) as "documentCount",
                COUNT(DISTINCT ch.id) as "chunkCount"
         FROM collections c
         LEFT JOIN documents d ON d.collection_id = c.id
         LEFT JOIN document_chunks ch ON ch.document_id = d.id
         WHERE c.name = $1
         GROUP BY c.id`;

    const result = await db.query(queryStr, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    res.json(mapCollection(result.rows[0]));
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch collection details", details: error.message });
  }
});

/**
 * POST /api/collections
 * Create a new documentation collection.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description } = req.body;

    if (!name || !displayName) {
      return res.status(400).json({ error: "Missing required fields: 'name' and 'displayName' are required" });
    }

    const slugRegex = /^[a-z0-9-_]+$/;
    if (!slugRegex.test(name)) {
      return res.status(400).json({ error: "Invalid 'name' format. Must be lower-case URL-friendly slug (e.g. nextjs-docs)" });
    }

    // Check conflict
    const conflictCheck = await db.query('SELECT id FROM collections WHERE name = $1', [name]);
    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({ error: `Collection with name '${name}' already exists` });
    }

    const result = await db.query(`
      INSERT INTO collections (name, display_name, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [name, displayName, description || ""]);

    res.status(201).json(mapCollection({ ...result.rows[0], documentCount: 0, chunkCount: 0 }));
  } catch (error: any) {
    res.status(500).json({ error: "Failed to create collection", details: error.message });
  }
});

/**
 * PUT /api/collections/:id
 * Update details of a documentation collection.
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { displayName, description } = req.body;

    if (!displayName) {
      return res.status(400).json({ error: "Missing required field: 'displayName'" });
    }

    const result = await db.query(`
      UPDATE collections
      SET display_name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [displayName, description || "", id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Collection not found" });
    }

    // Fetch counts to keep payload shape consistent
    const counts = await db.query(`
      SELECT COUNT(DISTINCT d.id) as "documentCount",
             COUNT(DISTINCT ch.id) as "chunkCount"
      FROM documents d
      LEFT JOIN document_chunks ch ON ch.document_id = d.id
      WHERE d.collection_id = $1
    `, [id]);

    res.json(mapCollection({ 
      ...result.rows[0], 
      documentCount: counts.rows[0].documentCount,
      chunkCount: counts.rows[0].chunkCount
    }));
  } catch (error: any) {
    res.status(500).json({ error: "Failed to update collection", details: error.message });
  }
});

/**
 * DELETE /api/collections/:id
 * Delete a collection and all associated document/vector data.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM collections WHERE id = $1 RETURNING display_name', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Collection not found" });
    }

    res.json({ 
      success: true, 
      message: `Collection '${result.rows[0].display_name}' and all its vector assets were successfully deleted.` 
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to delete collection", details: error.message });
  }
});

export default router;
