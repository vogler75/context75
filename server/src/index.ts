import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Load environment variables
dotenv.config();

// Standard command-line flag check for running MCP in stdio mode (e.g. for Claude Desktop)
if (process.argv.includes('--stdio')) {
  // Silence stdout logs to prevent corrupting stdio JSON-RPC streams
  console.log = () => {};
  
  const startMcpStdio = async () => {
    const { initDb } = await import('./db/index');
    const { startStdioMcp } = await import('./mcp/index');
    const { getEmbedder } = await import('./services/embedder');
    try {
      await initDb();
      await getEmbedder(); // Pre-warm the ONNX embedder model
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
    const { mcpServer, createMcpServer } = await import('./mcp/index');
    
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

    // Register MCP Streamable HTTP endpoints
    interface McpSession {
      transport: StreamableHTTPServerTransport;
      server: any;
    }
    const mcpSessions = new Map<string, McpSession>();

    const handleMcpRequest = async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId) {
        const session = mcpSessions.get(sessionId);
        if (!session) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Session not found'
            },
            id: null
          });
          return;
        }
        transport = session.transport;
      } else {
        // Create a new server instance for this session connection
        const sessionServer = createMcpServer();

        // Create a new transport session for initialization
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            if (transport) {
              mcpSessions.set(id, { transport, server: sessionServer });
            }
          },
          onsessionclosed: (id) => {
            mcpSessions.delete(id);
            sessionServer.close().catch((closeError: any) => {
              console.error("Failed to close session server:", closeError);
            });
          }
        });

        try {
          await sessionServer.connect(transport);
        } catch (connectError: any) {
          console.error("Failed to connect transport to session MCP server:", connectError);
          res.status(500).send("Internal Server Error");
          return;
        }
      }

      try {
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error("Error handling MCP Streamable HTTP request:", err);
        if (!res.headersSent) {
          res.status(500).send("Internal Server Error");
        }
      }
    };

    app.all('/api/mcp', handleMcpRequest);

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

      // Pre-warm the local embedding model
      const { getEmbedder } = await import('./services/embedder');
      await getEmbedder();

      // 2. Start Listening on all interfaces (0.0.0.0)
      app.listen(Number(PORT), '0.0.0.0', () => {
        console.log(`
===========================================================
  DOCUMENTATION SEARCH PLATFORM - ACTIVE WITH INTEGRATED MCP
===========================================================
  REST Server is running on: http://localhost:${PORT}
  MCP Endpoint is open on: http://localhost:${PORT}/api/mcp
  
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
  - Streamable HTTP Endpoint: http://localhost:${PORT}/api/mcp
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
