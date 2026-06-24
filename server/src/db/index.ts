import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'system',
  password: process.env.DB_PASSWORD || 'manager',
  database: process.env.DB_NAME || 'context75',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export const getClient = () => {
  return pool.connect();
};

/**
 * Initialize database functions and verify connections.
 */
export const initDb = async () => {
  const client = await pool.connect();
  try {
    // 1. Ensure the pgvector extension is enabled
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

    // 2. Ensure schema tables exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS collections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) UNIQUE NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          description TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          collection_id UUID REFERENCES collections(id) ON DELETE CASCADE NOT NULL,
          title VARCHAR(255) NOT NULL,
          file_path VARCHAR(512),
          file_type VARCHAR(10) NOT NULL,
          raw_content TEXT,
          checksum VARCHAR(64),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_chunks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
          chunk_index INT NOT NULL,
          content TEXT NOT NULL,
          embedding VECTOR(384) NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Create HNSW index for fast approximate cosine distance queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx 
      ON document_chunks USING hnsw (embedding vector_cosine_ops);
    `);

    console.log("Database tables and vector extensions successfully verified.");
  } catch (error) {
    console.error("Failed to initialize database schemas:", error);
    throw error;
  } finally {
    client.release();
  }
};
