# Documentation Server: REST API Specification (Draft/Mock)

This document describes the REST API endpoints exposed by the Documentation Server. The server is currently running locally at `http://localhost:8010` and serves mock responses conforming to this specification to enable parallel development of the Admin GUI.

---

## Base URL
```text
http://localhost:8010/api
```

---

## 1. System & Metrics

### Health Check
Verify the server uptime and connection status of database / model sub-services.

*   **URL**: `/health`
*   **Method**: `GET`
*   **Response (200 OK)**:
    ```json
    {
      "status": "healthy",
      "uptime": 245.62,
      "timestamp": "2026-06-03T12:27:04.829Z",
      "services": {
        "database": {
          "status": "connected",
          "driver": "pgvector",
          "latencyMs": 12
        },
        "embeddingModel": {
          "status": "loaded",
          "name": "Xenova/all-MiniLM-L6-v2",
          "device": "cpu",
          "dimension": 384
        },
        "mcpServer": {
          "status": "active",
          "transports": ["stdio", "sse"],
          "port": 8011
        }
      }
    }
    ```

### System Statistics
Fetch aggregated statistics across all collections (useful for dashboard cards).

*   **URL**: `/stats`
*   **Method**: `GET`
*   **Response (200 OK)**:
    ```json
    {
      "collectionsCount": 2,
      "documentsCount": 29,
      "chunksCount": 996,
      "totalStorageBytes": 253520,
      "memoryUsage": {
        "rss": 84521000,
        "heapTotal": 45123000,
        "heapUsed": 28452000,
        "external": 1542000
      },
      "cpuUsage": {
        "user": 1245000,
        "system": 341000
      }
    }
    ```

---

## 2. Collections Management

### List Collections
Retrieve all documentation libraries / product manuals.

*   **URL**: `/collections`
*   **Method**: `GET`
*   **Response (200 OK)**:
    ```json
    [
      {
        "id": "a3b926fa-a0d8-48f3-a121-b7d94da17bc3",
        "name": "nextjs-docs",
        "displayName": "Next.js Documentation",
        "description": "Next.js App Router and Pages Router documentation, guides, and API reference.",
        "documentCount": 24,
        "chunkCount": 842,
        "createdAt": "2026-06-03T12:00:00.000Z",
        "updatedAt": "2026-06-03T12:30:00.000Z"
      }
    ]
    ```

### Get Collection Details
*   **URL**: `/collections/:id`
*   **Method**: `GET`
*   **URL Parameters**: `:id` can be either the UUID (`id`) or the url slug (`name`).
*   **Response (200 OK)**:
    ```json
    {
      "id": "a3b926fa-a0d8-48f3-a121-b7d94da17bc3",
      "name": "nextjs-docs",
      "displayName": "Next.js Documentation",
      "description": "Next.js App Router and Pages Router documentation, guides, and API reference.",
      "documentCount": 24,
      "chunkCount": 842,
      "createdAt": "2026-06-03T12:00:00.000Z",
      "updatedAt": "2026-06-03T12:30:00.000Z"
    }
    ```
*   **Response (404 Not Found)**:
    ```json
    { "error": "Collection not found" }
    ```

### Create Collection
Create a new group for storing and vectorizing documentation.

*   **URL**: `/collections`
*   **Method**: `POST`
*   **Headers**: `Content-Type: application/json`
*   **Request Body**:
    ```json
    {
      "name": "react-native-docs",
      "displayName": "React Native Guides",
      "description": "Official documentation for React Native components, hooks, and native modules."
    }
    ```
    *Note: `name` must be a URL-friendly, lower-case slug (regex: `/^[a-z0-9-_]+$/`).*
*   **Response (201 Created)**:
    ```json
    {
      "id": "col_xyz789abc",
      "name": "react-native-docs",
      "displayName": "React Native Guides",
      "description": "Official documentation for React Native components, hooks, and native modules.",
      "documentCount": 0,
      "chunkCount": 0,
      "createdAt": "2026-06-03T12:35:10.123Z",
      "updatedAt": "2026-06-03T12:35:10.123Z"
    }
    ```
*   **Response (400 Bad Request)**:
    ```json
    { "error": "Missing required fields: 'name' and 'displayName' are required" }
    ```
    or
    ```json
    { "error": "Invalid 'name' format. Must be lower-case URL-friendly slug (e.g. nextjs-docs)" }
    ```
*   **Response (409 Conflict)**:
    ```json
    { "error": "Collection with name 'react-native-docs' already exists" }
    ```

### Update Collection
*   **URL**: `/collections/:id`
*   **Method**: `PUT`
*   **Headers**: `Content-Type: application/json`
*   **Request Body**:
    ```json
    {
      "displayName": "React Native Core Guides",
      "description": "Updated description for core Android and iOS layout files."
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "id": "col_xyz789abc",
      "name": "react-native-docs",
      "displayName": "React Native Core Guides",
      "description": "Updated description for core Android and iOS layout files.",
      "documentCount": 0,
      "chunkCount": 0,
      "createdAt": "2026-06-03T12:35:10.123Z",
      "updatedAt": "2026-06-03T12:40:00.000Z"
    }
    ```

### Delete Collection
*   **URL**: `/collections/:id`
*   **Method**: `DELETE`
*   **Response (200 OK)**:
    ```json
    {
      "success": true,
      "message": "Collection 'React Native Core Guides' and all its vector assets were successfully deleted."
    }
    ```

---

## 3. Documents Management

### List Documents in a Collection
*   **URL**: `/collections/:collectionId/documents`
*   **Method**: `GET`
*   **Response (200 OK)**:
    ```json
    [
      {
        "id": "d1a123fa-a0d8-48f3-a121-b7d94da17bc3",
        "collectionId": "a3b926fa-a0d8-48f3-a121-b7d94da17bc3",
        "title": "Getting Started with App Router",
        "filePath": "uploads/getting-started.md",
        "fileType": "md",
        "fileSizeBytes": 8420,
        "chunkCount": 10,
        "checksum": "sha256_8f3a525164bc952f4cda1a7c06b2b71452140efc1236541624b423cb1121d5a2",
        "createdAt": "2026-06-03T12:15:00.000Z",
        "updatedAt": "2026-06-03T12:15:00.000Z"
      }
    ]
    ```

### Get Document Metadata
*   **URL**: `/documents/:id`
*   **Method**: `GET`
*   **Response (200 OK)**:
    ```json
    {
      "id": "d1a123fa-a0d8-48f3-a121-b7d94da17bc3",
      "collectionId": "a3b926fa-a0d8-48f3-a121-b7d94da17bc3",
      "title": "Getting Started with App Router",
      "filePath": "uploads/getting-started.md",
      "fileType": "md",
      "fileSizeBytes": 8420,
      "chunkCount": 10,
      "checksum": "sha256_8f3a525164bc952f4cda1a7c06b2b71452140efc1236541624b423cb1121d5a2",
      "createdAt": "2026-06-03T12:15:00.000Z",
      "updatedAt": "2026-06-03T12:15:00.000Z"
    }
    ```

### Upload & Vectorize a Document
Upload a single PDF or Markdown file to be segmented, vectorized, and indexed.

*   **URL**: `/collections/:collectionId/upload`
*   **Method**: `POST`
*   **Headers**: `Content-Type: multipart/form-data`
*   **Request Form Fields**:
    - `file`: The raw file payload (must end with `.md`, `.mdx`, or `.pdf`).
    - `title` (optional): User-friendly title. Defaults to the uploaded filename.
*   **Response (201 Created)**:
    ```json
    {
      "message": "File successfully uploaded and vectorized.",
      "document": {
        "id": "doc_abc123xyz",
        "collectionId": "a3b926fa-a0d8-48f3-a121-b7d94da17bc3",
        "title": "Custom API Overview",
        "filePath": "uploads/1717417531-api-overview.md",
        "fileType": "md",
        "fileSizeBytes": 1240,
        "chunkCount": 3,
        "checksum": "sha256_mock_a8f9c2d1b0a7f9e8...",
        "createdAt": "2026-06-03T12:45:31.000Z",
        "updatedAt": "2026-06-03T12:45:31.000Z"
      }
    }
    ```

### Delete Document
Delete a single document and remove all of its associated vector embedding chunks.

*   **URL**: `/documents/:id`
*   **Method**: `DELETE`
*   **Response (200 OK)**:
    ```json
    {
      "success": true,
      "message": "Document 'Getting Started with App Router' and its associated vector chunks were successfully deleted."
    }
    ```

---

## 4. Chunk Explorer & Preview

### List Vector Chunks of a Document
Retrieve parsed text chunks and metadata snippets (such as the headers or page numbers they belong to) for rendering in chunk visualizers.

*   **URL**: `/documents/:id/chunks`
*   **Method**: `GET`
*   **Response (200 OK)**:
    ```json
    {
      "documentId": "d1a123fa-a0d8-48f3-a121-b7d94da17bc3",
      "documentTitle": "Getting Started with App Router",
      "chunks": [
        {
          "id": "chk_1",
          "chunkIndex": 0,
          "content": "Next.js is a flexible React framework that gives you building blocks to create fast web applications...",
          "embeddingSnippet": "[0.0241, -0.0152, 0.0894, -0.0034, 0.0512, ... 379 more dimensions]",
          "metadata": {
            "pageNumber": 1,
            "headerPath": ["Getting Started"]
          }
        }
      ]
    }
    ```

---

## 5. Semantic Vector Search

### Query Vector Search Simulator
Type a search query and evaluate what chunks and matching scores are returned.

*   **URL**: `/search`
*   **Method**: `POST`
*   **Headers**: `Content-Type: application/json`
*   **Request Body**:
    ```json
    {
      "collectionId": "a3b926fa-a0d8-48f3-a121-b7d94da17bc3",
      "query": "What is the Next.js App Router?",
      "limit": 5,
      "minSimilarity": 0.5
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "query": "What is the Next.js App Router?",
      "collectionId": "a3b926fa-a0d8-48f3-a121-b7d94da17bc3",
      "resultsCount": 2,
      "results": [
        {
          "chunkId": "chk_2",
          "documentId": "d1a123fa-a0d8-48f3-a121-b7d94da17bc3",
          "documentTitle": "Getting Started with App Router",
          "content": "The App Router is a newer paradigm for building applications using React's latest features, including React Server Components and nested layouts. It runs on a folder-based routing structure under the 'app' directory, supporting layouts, pages, loading states, error boundaries, and API routes.",
          "similarity": 0.8924,
          "metadata": {
            "pageNumber": 1,
            "headerPath": ["Getting Started", "The App Router"]
          }
        },
        {
          "chunkId": "chk_1",
          "documentId": "d1a123fa-a0d8-48f3-a121-b7d94da17bc3",
          "documentTitle": "Getting Started with App Router",
          "content": "Next.js is a flexible React framework that gives you building blocks to create fast web applications...",
          "similarity": 0.6518,
          "metadata": {
            "pageNumber": 1,
            "headerPath": ["Getting Started"]
          }
        }
      ]
    }
    ```
