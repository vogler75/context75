import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'linux5',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'system',
  password: process.env.DB_PASSWORD || 'manager',
  database: process.env.DB_NAME || 'context9',
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
    // 1. Drop old real[] signature if it exists to avoid overloading conflicts
    await client.query(`DROP FUNCTION IF EXISTS cosine_similarity(real[], real[]);`);

    // 2. Ensure the stable double precision cosine_similarity helper function exists
    await client.query(`
      CREATE OR REPLACE FUNCTION cosine_similarity(a double precision[], b double precision[]) 
      RETURNS double precision AS $$
      DECLARE
          dot_product double precision := 0;
          norm_a double precision := 0;
          norm_b double precision := 0;
          i integer;
      BEGIN
          FOR i IN 1..array_length(a, 1) LOOP
              dot_product := dot_product + (a[i] * b[i]);
              norm_a := norm_a + (a[i] * a[i]);
              norm_b := norm_b + (b[i] * b[i]);
          END LOOP;
          IF norm_a = 0 OR norm_b = 0 THEN
              RETURN 0;
          END IF;
          RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // 2. Ensure schema tables exist (as fallback)
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
          embedding real[] NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Database tables and custom cosine_similarity functions successfully verified.");
  } catch (error) {
    console.error("Failed to initialize database schemas:", error);
    throw error;
  } finally {
    client.release();
  }
};
