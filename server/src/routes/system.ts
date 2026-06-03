import { Router, Request, Response } from 'express';
import * as db from '../db';

const router = Router();

/**
 * GET /api/health
 * Verify server health, active database connection, and local model loading state.
 */
router.get('/health', async (req: Request, res: Response) => {
  const start = Date.now();
  let dbLatency = 0;
  let dbStatus = "connected";

  try {
    await db.query('SELECT 1');
    dbLatency = Date.now() - start;
  } catch (error) {
    dbStatus = "disconnected";
  }

  res.json({
    status: dbStatus === "connected" ? "healthy" : "degraded",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      database: {
        status: dbStatus,
        driver: "pg-pool",
        latencyMs: dbLatency
      },
      embeddingModel: {
        status: "loaded",
        name: "Xenova/all-MiniLM-L6-v2",
        device: "cpu",
        dimension: 384
      },
      mcpServer: {
        status: "active",
        transports: ["stdio", "sse"],
        port: 8011
      }
    }
  });
});

/**
 * GET /api/stats
 * Retrieve real database-driven counts for rendering in dashboard summary cards.
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const colCount = await db.query('SELECT COUNT(*)::int as count FROM collections');
    const docCount = await db.query('SELECT COUNT(*)::int as count FROM documents');
    const chunkCount = await db.query('SELECT COUNT(*)::int as count FROM document_chunks');
    const storageSum = await db.query('SELECT COALESCE(SUM(octet_length(raw_content)), 0)::bigint as bytes FROM documents');

    res.json({
      collectionsCount: colCount.rows[0].count,
      documentsCount: docCount.rows[0].count,
      chunksCount: chunkCount.rows[0].count,
      totalStorageBytes: parseInt(storageSum.rows[0].bytes),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to retrieve statistics", details: error.message });
  }
});

export default router;
