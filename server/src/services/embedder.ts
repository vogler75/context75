let pipelineInstance: any = null;

/**
 * Dynamically import and initialize the Transformers feature-extraction pipeline.
 * We use Xenova/all-MiniLM-L6-v2 which generates a 384-dimensional vector embedding.
 */
export const getEmbedder = async () => {
  if (!pipelineInstance) {
    try {
      // Use a dynamic import constructor to bypass TypeScript's CommonJS require() transpilation
      const { pipeline } = await (new Function('return import("@xenova/transformers")')() as any);
      pipelineInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        progress_callback: () => {} // Completely silent, prevents stdout stream pollution in MCP stdio mode
      });
    } catch (error) {
      console.error("Failed to load local embedding model Xenova/all-MiniLM-L6-v2:", error);
      throw error;
    }
  }
  return pipelineInstance;
};

/**
 * Generate a 384-dimensional vector embedding for a given text string.
 */
export const generateEmbedding = async (text: string): Promise<number[]> => {
  const embedder = await getEmbedder();
  
  // Clean double spaces or newlines to get consistent embeddings
  const cleanText = text.replace(/\s+/g, ' ').trim();
  if (cleanText.length === 0) {
    return new Array(384).fill(0);
  }

  const output = await embedder(cleanText, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
};
