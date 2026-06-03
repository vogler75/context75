# Implementation Plan: Documentation Server with Integrated MCP Server

This plan outlines the architecture, database schema, ingestion pipeline, API endpoints, and step-by-step implementation details for a Node.js-based documentation platform. It splits the system into a **Documentation Server (with REST API and MCP capabilities)** and an **Admin Dashboard**.

---

## 1. System Architecture

The project consists of three main components:
1. **Database**: PostgreSQL with the `pgvector` extension for metadata and semantic chunk storage.
2. **Documentation Server (Backend)**:
   - **REST API Service**: For document upload, collection management, and standard search/retrieval.
   - **MCP Server**: Implements the Model Context Protocol (MCP) using the official TypeScript/Node.js SDK, enabling LLMs to fetch, search, and browse documentations via SSE (Server-Sent Events) or `stdio` transport.
   - **Ingestion Engine**: Extracts text from Markdown and PDF files, chunks the content, generates vector embeddings, and stores them in PostgreSQL.
3. **Admin Dashboard (Frontend)**:
   - A modern React SPA built using Vite.
   - Provides UIs for creating collections, uploading documents (PDFs, Markdown), editing metadata, and testing searches.

```mermaid
graph TD
    User([Admin User]) -->|Manages Docs| AdminDashboard[Admin Dashboard (React + Vite)]
    AIClient([AI Client (Cursor, Claude Desktop, etc.)]) -->|MCP SSE / stdio| MCPServer[MCP Server Interface]
    AdminDashboard -->|REST API| RESTAPI[REST API Router]
    
    subgraph Documentation Server (Node.js)
        RESTAPI --> IngestionEngine[Ingestion Engine]
        IngestionEngine --> Parser[Parsers (Markdown / pdf-parse)]
        Parser --> Chunker[Chunker & Embedder (Transformers.js / OpenAI)]
        MCPServer --> VectorSearch[Vector Search Handler]
    end
    
    Chunker -->|Write Vectors & Metadata| DB[(PostgreSQL + pgvector)]
    VectorSearch -->|Query Semantics| DB
    RESTAPI -->|Manage Metadata| DB
```

---

## 2. Technology Stack

- **Server Language/Runtime**: Node.js (TypeScript)
- **Database**: PostgreSQL (v15+) with `pgvector` extension
- **Database ORM**: Drizzle ORM (native `pgvector` helper support) or Prisma (via raw SQL queries for cosine similarity)
- **REST API Framework**: Fastify or Express
- **MCP Protocol**: `@modelcontextprotocol/sdk` (TypeScript)
- **Document Parsing**:
  - **Markdown**: `gray-matter` (for frontmatter extraction) + standard regex/marked-based parsing.
  - **PDF Extraction**: `pdf-parse` (pure JS PDF text extractor, zero python requirements).
- **Embeddings & Vectorization (Node.js native)**:
  - *Option A (Local / Cost-free)*: `@xenova/transformers` (Transformers.js) using the `Xenova/all-MiniLM-L6-v2` ONNX model (dimension: 384). Runs completely inside Node.js, no external API keys or python runtime needed.
  - *Option B (Cloud / High Accuracy)*: Official `@google/genai` or `openai` SDK for generating text embeddings (e.g., `text-embedding-3-small` / dimension: 1536).
- **Admin Dashboard**: Vite + React + TypeScript + TailwindCSS / shadcn/ui.

---

## 3. Database Schema Design (PostgreSQL + pgvector)

The database will store collections (document groups), documents, and chunks with their vector embeddings.

```sql
-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Collections (e.g., 'nextjs-docs', 'internal-crm-manual')
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL, -- url-friendly slug
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Documents (individual uploaded markdown or pdf files)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(255) NOT NULL,
    file_path VARCHAR(512), -- storage location path
    file_type VARCHAR(10) NOT NULL, -- 'md' or 'pdf'
    raw_content TEXT, -- cached full-text representation
    checksum VARCHAR(64), -- MD5/SHA256 to avoid re-vectorizing unmodified files
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Document Chunks (for semantic retrieval)
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(384) NOT NULL, -- Matches dimension of Xenova/all-MiniLM-L6-v2 (use 1536 for OpenAI)
    metadata JSONB, -- store page numbers, header structures, source URLs
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast cosine similarity search
CREATE INDEX ON document_chunks USING hnsw (embedding vector_cosine_ops);
```

---

## 4. Ingestion & Vectorization Pipeline

The pipeline is triggered when a file is uploaded to the REST API:

1. **Extraction**:
   - **Markdown Files**: Extract frontmatter metadata using `gray-matter`. The rest of the file is processed as raw markdown text.
   - **PDF Files**: Stream the file buffer into `pdf-parse`. It extracts page-by-page text mapping. PDF pages are converted into clean plain-text/pseudo-markdown formatting (adding headers representing the document name and page number).
2. **Chunking**:
   - Split document texts using a **Recursive Character Text Chunker**.
   - Ideal chunk size: **800 - 1000 characters** with an overlap of **100 - 200 characters**.
   - Keep page numbers, headers, and document paths attached as metadata to each chunk.
3. **Embedding Generation**:
   - Generate embeddings using Node.js:
     ```typescript
     import { pipeline } from '@xenova/transformers';
     
     // Initialize the feature extraction pipeline
     const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
     
     // Generate embeddings for chunk content
     const output = await embedder(chunkText, { pooling: 'mean', normalize: true });
     const embeddingVector = Array.from(output.data); // array of numbers (length: 384)
     ```
4. **Storage**:
   - Upsert metadata into `documents`.
   - Batch insert the generated chunks and vector arrays into `document_chunks`.

---

## 5. Server REST API Specifications

The server will expose a clean REST API for management operations.

| Endpoint | Method | Description | Request Body / Parameters |
| :--- | :--- | :--- | :--- |
| `/api/collections` | `GET` | List all document collections | None |
| `/api/collections` | `POST` | Create a new documentation collection | `{ name, display_name, description }` |
| `/api/collections/:id` | `DELETE` | Delete a collection and all its vectors | None |
| `/api/collections/:id/documents` | `GET` | List documents inside a collection | None |
| `/api/collections/:id/upload` | `POST` | Upload and vectorize MD or PDF files | Multipart/form-data (`file`, `title`) |
| `/api/documents/:id` | `DELETE` | Delete a document and its chunks | None |
| `/api/search` | `POST` | Query vector search directly via REST | `{ collection_name, query, limit }` |

---

## 6. Integrated MCP Server Specification

The Documentation Server embeds an MCP Server that exposes documentation toolsets directly to AI clients.

### Transport Mechanisms
1. **SSE (Server-Sent Events)**: Recommended for running the server on a port (e.g., `:8010/sse`), allowing external agents (Cursor, Claude Desktop) to connect via network requests.
2. **stdio**: Useful for spawning the server as a local child process inside the editor settings.

### Exposed MCP Tools

#### 1. `list_collections`
- **Description**: Returns all documentation libraries available on the server.
- **Input Schema**: None.

#### 2. `search_documentation`
- **Description**: Performs a hybrid semantic-vector and metadata query to find documentation snippets related to a search query.
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "collectionName": { "type": "string", "description": "The slug name of the documentation collection to search." },
      "query": { "type": "string", "description": "The search query (e.g., 'How to configure middleware in Next.js?')" },
      "limit": { "type": "integer", "description": "Number of results to retrieve (default: 5)" }
    },
    "required": ["collectionName", "query"]
  }
  ```

#### 3. `get_document_outline`
- **Description**: Retrieves the document structure and list of pages in a collection.
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "collectionName": { "type": "string" }
    },
    "required": ["collectionName"]
  }
  ```

#### 4. `get_document_content`
- **Description**: Retrieves the raw content of a specific document page.
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "documentId": { "type": "string", "description": "The unique UUID of the document page." }
    },
    "required": ["documentId"]
  }
  ```

---

## 7. Admin Dashboard UI Features

The dashboard will be a standalone single-page application targeting administrators.
- **Collections Grid**: Displays cards of all software libraries and collections (e.g., "React Native Docs", "Company HR Policy"). Shows chunk and document counts.
- **Ingestion Portal**: Drag-and-drop file uploader supporting Markdown (`.md`, `.mdx`) and PDFs (`.pdf`). Features progress tracking for upload, text conversion, and embedding generation phases.
- **Document Explorer**: A tree-view explorer to browse files in a collection. Allows editing titles or deleting old documents.
- **Vector Search Simulator**: A sandbox UI allowing administrators to type queries, select a collection, run semantic searches, and visualize returned chunks alongside their match scores.

---

## 8. Directory Structure

```text
documentation-mcp-platform/
├── package.json
├── tsconfig.json
├── docker-compose.yml           # Database and server orchestration
├── server/                      # Documentation Server (Express/Fastify + MCP)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts             # Entry point (REST + MCP SSE startup)
│   │   ├── db/                  # Database connections and schema models
│   │   │   ├── index.ts
│   │   │   └── schema.ts
│   │   ├── routes/              # Express/Fastify REST endpoints
│   │   │   ├── collections.ts
│   │   │   ├── documents.ts
│   │   │   └── search.ts
│   │   ├── mcp/                 # MCP Server tool definitions & transport configuration
│   │   │   ├── index.ts
│   │   │   └── tools.ts
│   │   └── services/            # File ingestion, chunking, and embedding engines
│   │       ├── parser.ts
│   │       ├── chunker.ts
│   │       └── embedder.ts
└── dashboard/                   # Admin Panel (Vite + React SPA)
    ├── package.json
    ├── index.html
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── components/          # Reusable UI components
    │   ├── pages/               # Main pages (Dashboard, Ingest, Search Simulator)
    │   └── services/            # API clients to communicate with the REST Server
```

---

## 9. Implementation Roadmap

### Phase 1: PostgreSQL and Database Setup
1. Spin up a PostgreSQL instance with the `pgvector` extension.
2. Initialize a TypeScript Node project and configure Drizzle ORM (or Prisma) schemas corresponding to the Collections, Documents, and Chunks tables.
3. Write database migrations and set up connection helper classes.

### Phase 2: Parser and Embedding Engine (Node.js Native)
1. Write the parser utility:
   - For Markdown: Read contents directly.
   - For PDF: Install `pdf-parse`, read file buffer, convert stream to plain text.
2. Write a recursive character chunker that segments text into ~800-character segments, maintaining word boundaries.
3. Implement `embedder.ts` using `@xenova/transformers`. Fetch `Xenova/all-MiniLM-L6-v2` locally or integrate with the Google Gemini API using `@google/genai` (preferred if cloud speed is selected).

### Phase 3: REST Server & Upload Endpoints
1. Create a server using Fastify/Express.
2. Implement endpoints to manage collections (`GET`, `POST`, `DELETE`).
3. Set up a multipart file upload route using `multer` or `fastify-multipart`.
4. Connect the file upload route to the ingestion engine: parses, chunks, vectorizes, and saves chunk objects with embedding arrays `[0.1, -0.4, ...]` to Postgres.

### Phase 4: Integrated MCP Server
1. Initialize the MCP Server using `@modelcontextprotocol/sdk`.
2. Define the core tools (`list_collections`, `search_documentation`, `get_document_content`).
3. Connect `search_documentation` directly to Postgres via vector cosine similarity query:
   ```sql
   SELECT content, metadata, 1 - (embedding <=> :query_embedding) AS similarity
   FROM document_chunks
   WHERE collection_id = :id
   ORDER BY embedding <=> :query_embedding
   LIMIT :limit;
   ```
4. Expose the server via SSE transport over `/sse` endpoint and configure optional stdio transport.

### Phase 5: Admin Dashboard UI
1. Create a React project using Vite.
2. Build the Dashboard shell.
3. Build the collection management panel.
4. Implement a drag-and-drop file uploader sending files directly to the upload REST endpoint.
5. Create a playground page where admins can test semantic query search results and debug context relevance.
