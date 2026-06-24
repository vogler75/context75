import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ErrorCode,
  McpError 
} from "@modelcontextprotocol/sdk/types.js";
import * as db from "../db/index";
import { generateEmbedding } from "../services/embedder";

const logMcp = (message: string, ...args: any[]) => {
  console.error(`[MCP] ${message}`, ...args);
};

// Initialize the MCP Server
export const createMcpServer = () => {
  const server = new Server({
    name: "documentation-mcp-server",
    version: "1.0.0"
  }, {
    capabilities: {
      tools: {},
      resources: {}
    },
    instructions: "Documentation search MCP server for semantic documentation lookup. Perform semantic vector search across specific collections to find relevant text fragments and retrieve document content directly into your LLM context."
  });

  // Register ListTools request handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logMcp("Listing tools requested");
    return {
      tools: [
        {
          name: "list_collections",
          description: "List all available documentation collections / products with their descriptions and document counts.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "search_documentation",
          description: "Perform a semantic vector search across a specific documentation collection to find relevant text fragments.",
          inputSchema: {
            type: "object",
            properties: {
              collectionName: { 
                type: "string", 
                description: "The slug name of the collection to search (e.g. 'nextjs-docs'). Use list_collections to find active names." 
              },
              query: { 
                type: "string", 
                description: "The search query (e.g., 'how do I configure dynamic routes or layouts?')." 
              },
              limit: { 
                type: "integer", 
                description: "Max number of matches to return (default is 5, max is 10)." 
              },
              minSimilarity: {
                type: "number",
                description: "Minimum cosine similarity score from 0.0 to 1.0 (default is 0.45)."
              }
            },
            required: ["collectionName", "query"]
          }
        },
        {
          name: "get_document_content",
          description: "Retrieve the full text content of a specific document page by its UUID.",
          inputSchema: {
            type: "object",
            properties: {
              documentId: { 
                type: "string", 
                description: "The unique UUID of the document page. You can discover this ID from search results." 
              }
            },
            required: ["documentId"]
          }
        }
      ]
    };
  });

  // Register CallTool request handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logMcp(`Calling tool: ${name} with arguments:`, args);

    try {
      let response;

      if (name === "list_collections") {
        const result = await db.query(`
          SELECT c.id, c.name, c.display_name, c.description, 
                 COUNT(d.id)::int as "documentCount"
          FROM collections c
          LEFT JOIN documents d ON d.collection_id = c.id
          GROUP BY c.id
          ORDER BY c.name ASC
        `);

        response = {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rows, null, 2)
            }
          ]
        };
      } else if (name === "search_documentation") {
        const { collectionName, query, limit = 5, minSimilarity = 0.45 } = args as any;

        if (!collectionName || !query) {
          throw new McpError(ErrorCode.InvalidParams, "Missing required parameters: 'collectionName' and 'query' must be provided.");
        }

        // Resolve collectionId from name
        const colCheck = await db.query('SELECT id, display_name FROM collections WHERE name = $1', [collectionName]);
        if (colCheck.rows.length === 0) {
          response = {
            content: [
              {
                type: "text",
                text: `Error: Collection with slug '${collectionName}' was not found. Please run list_collections tool to verify names.`
              }
            ],
            isError: true
          };
        } else {
          const collectionId = colCheck.rows[0].id;

          // Generate embedding for query text (local all-MiniLM-L6-v2 ONNX)
          const queryEmbedding = await generateEmbedding(query);
          const queryEmbeddingStr = `[${queryEmbedding.join(',')}]`;

          // Perform cosine similarity database query using native pgvector <=> operator
          const searchResult = await db.query(`
            SELECT ch.content,
                   ch.metadata,
                   d.title as "documentTitle",
                   1 - (ch.embedding <=> $1::vector) as similarity
            FROM document_chunks ch
            JOIN documents d ON d.id = ch.document_id
            WHERE d.collection_id = $2
              AND (1 - (ch.embedding <=> $1::vector)) >= $3
            ORDER BY similarity DESC
            LIMIT $4
          `, [queryEmbeddingStr, collectionId, minSimilarity, Math.min(10, Number(limit))]);

          if (searchResult.rows.length === 0) {
            response = {
              content: [
                {
                  type: "text",
                  text: `No matching documentation chunks found for query "${query}" in collection "${collectionName}" with similarity >= ${minSimilarity}.`
                }
              ]
            };
          } else {
            const formattedResults = searchResult.rows.map((row, index) => {
              const pageInfo = row.metadata?.pageNumber ? `(Page ${row.metadata.pageNumber})` : "";
              const headerInfo = row.metadata?.headerPath?.length > 0 ? ` > ${row.metadata.headerPath.join(' > ')}` : "";
              
              return `[Result ${index + 1}] Source: ${row.documentTitle} ${pageInfo}${headerInfo} [Score: ${row.similarity.toFixed(4)}]\n---\n${row.content}\n---`;
            }).join("\n\n");

            response = {
              content: [
                {
                  type: "text",
                  text: formattedResults
                }
              ]
            };
          }
        }
      } else if (name === "get_document_content") {
        const { documentId } = args as any;

        if (!documentId) {
          throw new McpError(ErrorCode.InvalidParams, "Missing required parameter 'documentId'.");
        }

        const docResult = await db.query(
          'SELECT d.title, d.raw_content, c.display_name as "collectionName" FROM documents d JOIN collections c ON c.id = d.collection_id WHERE d.id = $1',
          [documentId]
        );

        if (docResult.rows.length === 0) {
          response = {
            content: [
              {
                type: "text",
                text: `Error: Document with ID '${documentId}' not found.`
              }
            ],
            isError: true
          };
        } else {
          const { title, raw_content, collectionName } = docResult.rows[0];

          response = {
            content: [
              {
                type: "text",
                text: `Document: ${title}\nCollection: ${collectionName}\n=========================================\n${raw_content}`
              }
            ]
          };
        }
      } else {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      logMcp(`Tool ${name} call succeeded with response status (isError: ${!!response.isError})`);
      return response;

    } catch (error: any) {
      if (error instanceof McpError) {
        logMcp(`Tool execution warning [${name}]: McpError: MCP error ${error.code}: ${error.message}`);
      } else {
        logMcp(`Tool execution error [${name}]:`, error);
      }
      return {
        content: [
          {
            type: "text",
            text: `Internal MCP tool error: ${error.message || error}`
          }
        ],
        isError: true
      };
    }
  });

  // Register ListResources request handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    logMcp("Listing resources requested");
    try {
      const result = await db.query(`
        SELECT name, display_name, description
        FROM collections
        ORDER BY name ASC
      `);

      const resources = result.rows.map((row) => ({
        uri: `collections://${row.name}`,
        name: `Collection: ${row.display_name}`,
        description: row.description || `Documents in collection ${row.display_name}`,
        mimeType: "application/json"
      }));

      logMcp(`Found ${resources.length} resources`);
      return { resources };
    } catch (error) {
      console.error("Failed to list resources:", error);
      throw error;
    }
  });

  // Register ListResourceTemplates request handler
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    logMcp("Listing resource templates requested");
    const templates = [
      {
        uriTemplate: "collections://{collectionName}/documents/{documentId}",
        name: "Document content",
        description: "Get the raw markdown or text content of a specific document within a collection.",
        mimeType: "text/markdown"
      }
    ];
    return { resourceTemplates: templates };
  });

  // Register ReadResource request handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    logMcp(`Reading resource: ${uri}`);

    try {
      if (uri.startsWith("collections://")) {
        const pathParts = uri.substring("collections://".length).split("/");
        
        if (pathParts.length === 1) {
          const collectionName = pathParts[0];
          const colCheck = await db.query('SELECT id, display_name, description FROM collections WHERE name = $1', [collectionName]);
          if (colCheck.rows.length === 0) {
            throw new McpError(ErrorCode.InvalidParams, `Collection '${collectionName}' not found.`);
          }
          const col = colCheck.rows[0];

          const docsResult = await db.query('SELECT id, title, updated_at FROM documents WHERE collection_id = $1 ORDER BY title ASC', [col.id]);
          
          const collectionDetails = {
            id: col.id,
            name: collectionName,
            displayName: col.display_name,
            description: col.description,
            documents: docsResult.rows.map(doc => ({
              id: doc.id,
              title: doc.title,
              updatedAt: doc.updated_at,
              uri: `collections://${collectionName}/documents/${doc.id}`
            }))
          };

          logMcp(`Successfully read collection details for resource ${uri}`);
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(collectionDetails, null, 2)
              }
            ]
          };
        } else if (pathParts.length === 3 && pathParts[1] === "documents") {
          const collectionName = pathParts[0];
          const documentId = pathParts[2];

          const docResult = await db.query(
            'SELECT d.title, d.raw_content, c.display_name as "collectionName" FROM documents d JOIN collections c ON c.id = d.collection_id WHERE d.id = $1 AND c.name = $2',
            [documentId, collectionName]
          );

          if (docResult.rows.length === 0) {
            throw new McpError(ErrorCode.InvalidParams, `Document '${documentId}' in collection '${collectionName}' not found.`);
          }

          const { title, raw_content, collectionName: cName } = docResult.rows[0];

          logMcp(`Successfully read document content for resource ${uri}`);
          return {
            contents: [
              {
                uri,
                mimeType: "text/markdown",
                text: `# ${title}\nCollection: ${cName}\n\n${raw_content}`
              }
            ]
          };
        }
      }

      throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI pattern: ${uri}`);
    } catch (error: any) {
      if (error instanceof McpError) {
        logMcp(`Resource read warning [${uri}]: McpError: MCP error ${error.code}: ${error.message}`);
      } else {
        logMcp(`Resource read error [${uri}]:`, error);
      }
      throw error;
    }
  });

  return server;
};

export const mcpServer = createMcpServer();

/**
 * Connect the MCP server to stdio transport (useful for IDE execution).
 */
export const startStdioMcp = async () => {
  try {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("MCP Server successfully started on stdio transport.");
  } catch (error) {
    console.error("Failed to connect stdio transport for MCP:", error);
    process.exit(1);
  }
};
