# Context75 - Documentation Search MCP Server

A semantic documentation search server that integrates with the Model Context Protocol (MCP). It enables LLMs to perform intelligent vector-based search across documentation collections, retrieving relevant content directly into context.

## Overview

Context75 provides:
- **Semantic Search**: Vector-based semantic search across documentation collections using embeddings
- **MCP Integration**: Expose documentation search capabilities as MCP tools for Claude and other LLM clients
- **REST API**: Full REST API for managing collections, documents, and performing searches
- **Document Management**: Upload, organize, and manage documentation in collections
- **Vector Indexing**: Automatic chunking and embedding of documents with pgvector

## Architecture

The server consists of:
- **Express API Server**: RESTful endpoints for collections, documents, and search
- **MCP Server**: Model Context Protocol endpoints for LLM integration (stdio + SSE transports)
- **Database Layer**: PostgreSQL with pgvector for vector storage and search
- **Embedding Service**: Transformers.js for local embedding generation
- **Document Processing**: PDF and Markdown parsing with automatic chunking

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL with pgvector extension
- npm or yarn

### Installation

```bash
cd server
npm install
```

### Environment Setup

Create a `.env` file in the `server` directory:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/context75
MCP_SERVER_PORT=8011
API_SERVER_PORT=8010
NODE_ENV=development
```

### Running the Server

**Development mode:**
```bash
npm run dev
```

**Production build:**
```bash
npm run build
npm start
```

The server will start with:
- REST API on `http://localhost:8010`
- MCP server on port `8011` (stdio + SSE transports)

## API Endpoints

### Health & System
- `GET /api/health` - Server health check and service status
- `GET /api/stats` - System statistics (collections, documents, storage)

### Collections
- `GET /api/collections` - List all collections
- `GET /api/collections/:id` - Get collection details
- `POST /api/collections` - Create a new collection
- `PUT /api/collections/:id` - Update collection metadata
- `DELETE /api/collections/:id` - Delete a collection

### Documents
- `GET /api/collections/:collectionId/documents` - List documents in a collection
- `GET /api/documents/:id` - Get document metadata
- `POST /api/collections/:collectionId/upload` - Upload and vectorize a document
- `DELETE /api/documents/:id` - Delete a document

### Vector Chunks
- `GET /api/documents/:id/chunks` - View document chunks and embeddings

### Search
- `POST /api/search` - Perform semantic vector search across a collection

See `api_spec.md` for detailed endpoint specifications and example requests.

## MCP Tools

When running as an MCP server, the following tools are available to LLM clients:

- **search_documentation**: Perform semantic search across a documentation collection
- **list_collections**: Browse available documentation libraries
- **get_collection_details**: Retrieve metadata about a specific collection

## Key Features

- **Automatic Vectorization**: Documents are automatically chunked and embedded on upload
- **Semantic Search**: Find relevant content by meaning, not just keyword matching
- **Multiple Document Formats**: Support for Markdown, Markdown with front-matter, and PDF
- **Efficient Storage**: Uses pgvector for optimized similarity search on large embedding collections
- **Collection Organization**: Group related documentation into logical collections
- **Real-time Indexing**: Immediate availability of documents after upload

## Project Structure

```
server/
├── src/
│   ├── index.ts           # Server setup and initialization
│   ├── db/                # Database and vector operations
│   ├── mcp/               # MCP protocol handlers
│   ├── routes/            # REST API endpoints
│   └── services/          # Business logic (embeddings, document processing)
├── dist/                  # Compiled JavaScript
└── package.json
```

## Development

Watch mode with hot reload:
```bash
npm run dev
```

Type checking:
```bash
npx tsc --noEmit
```

## Database

The server uses PostgreSQL with the pgvector extension for vector operations. Create the database schema by running initialization queries from `src/db/`.

Key tables:
- `collections` - Documentation groups
- `documents` - Files within collections
- `vector_chunks` - Text segments with embeddings
- `embeddings` - Vector data with cosine similarity indexing

## License

MIT
