import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// Load environment variables
dotenv.config();

// Standard command-line flag check for running MCP in stdio mode (e.g. for Claude Desktop)
if (process.argv.includes('--stdio')) {
  // Silence stdout logs to prevent corrupting stdio JSON-RPC streams
  console.log = () => {};
  
  const startMcpStdio = async () => {
    const { initDb } = await import('./db/index');
    const { startStdioMcp } = await import('./mcp/index');
    try {
      await initDb();
      await startStdioMcp();
    } catch (err) {
      console.error("Critical failure initializing database for Stdio MCP server:", err);
      process.exit(1);
    }
  };
  startMcpStdio();
} else {
  // Normal Web/REST mode
  const startApp = async () => {
    const { initDb } = await import('./db/index');
    const { mcpServer } = await import('./mcp/index');
    
    // Import routers
    const collectionsRouter = (await import('./routes/collections')).default;
    const documentsRouter = (await import('./routes/documents')).default;
    const searchRouter = (await import('./routes/search')).default;
    const systemRouter = (await import('./routes/system')).default;

    const app = express();
    const PORT = process.env.PORT || 8010;

    // Ensure upload directory exists
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Middleware
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Serve raw uploads if front-end needs to display the files directly
    app.use('/uploads', express.static(uploadDir));

    // Serve Admin Dashboard GUI
    const publicDir = path.join(__dirname, '../public');
    app.use(express.static(publicDir));

    // Register REST routers
    app.use('/api/collections', collectionsRouter);
    app.use('/api', documentsRouter);
    app.use('/api/search', searchRouter);
    app.use('/api', systemRouter);

    // Register MCP SSE Server-Sent Events endpoints
    const mcpTransports = new Map<string, SSEServerTransport>();

    app.get('/sse', async (req: express.Request, res: express.Response) => {
      const transport = new SSEServerTransport('/api/mcp/message', res);
      mcpTransports.set(transport.sessionId, transport);
      
      await mcpServer.connect(transport);
      
      req.on('close', () => {
        mcpTransports.delete(transport.sessionId);
      });
    });

    app.post('/api/mcp/message', async (req: express.Request, res: express.Response) => {
      const sessionId = req.query.sessionId as string;
      const transport = mcpTransports.get(sessionId);
      
      if (!transport) {
        return res.status(400).send(`No active SSE session found for ID: ${sessionId}`);
      }
      
      await transport.handlePostMessage(req, res);
    });

    // Global Error Handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error("Unhandled server error:", err);
      res.status(500).json({
        error: "Internal Server Error",
        message: err.message || "An unexpected error occurred on the server."
      });
    });

    // Wildcard Route
    app.use('*', (req: express.Request, res: express.Response) => {
      res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
    });

    try {
      // 1. Verify and initialize Database
      await initDb();

      // 2. Start Listening on all interfaces (0.0.0.0)
      app.listen(Number(PORT), '0.0.0.0', () => {
        console.log(`
===========================================================
  DOCUMENTATION SEARCH PLATFORM - ACTIVE WITH INTEGRATED MCP
===========================================================
  REST Server is running on: http://localhost:${PORT}
  MCP SSE Endpoint is open on: http://localhost:${PORT}/sse
  
  Available Endpoints:
  
  [SYSTEM & STATISTICS]
  - GET  http://localhost:${PORT}/api/health
  - GET  http://localhost:${PORT}/api/stats
  
  [COLLECTIONS]
  - GET  http://localhost:${PORT}/api/collections
  - GET  http://localhost:${PORT}/api/collections/:id
  - POST http://localhost:${PORT}/api/collections (JSON body)
  - PUT  http://localhost:${PORT}/api/collections/:id (JSON body)
  - DELETE http://localhost:${PORT}/api/collections/:id
  
  [DOCUMENTS]
  - GET  http://localhost:${PORT}/api/collections/:collectionId/documents
  - GET  http://localhost:${PORT}/api/documents/:id
  - GET  http://localhost:${PORT}/api/documents/:id/chunks (Chunk details)
  - POST http://localhost:${PORT}/api/collections/:collectionId/upload (File multipart)
  - DELETE http://localhost:${PORT}/api/documents/:id
  
  [SEMANTIC SEARCH]
  - POST http://localhost:${PORT}/api/search (JSON body)
  
  [MCP (MODEL CONTEXT PROTOCOL)]
  - GET  http://localhost:${PORT}/sse (Connect Cursor/SSE client)
  - POST http://localhost:${PORT}/api/mcp/message (SSE messaging channel)
  - Standard command-line launch: node dist/index.js --stdio
===========================================================
        `);
      });
    } catch (error) {
      console.error("Critical startup failure: Failed to connect or initialize PostgreSQL database context9.", error);
      process.exit(1);
    }
  };

  startApp();
}
