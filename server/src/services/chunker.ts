export interface Chunk {
  content: string;
  chunkIndex: number;
  metadata: {
    pageNumber?: number;
    headerPath: string[];
  };
}

/**
 * Split text into semantic chunks without cutting off sentences.
 * Groups sentences until the character limit is reached, then overlaps.
 */
export const chunkText = (
  text: string, 
  chunkSize = 800, 
  chunkOverlap = 150, 
  pageNumber?: number,
  headerPath: string[] = []
): Chunk[] => {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Split text by sentence boundaries, maintaining the delimiter
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  const chunks: Chunk[] = [];
  let currentChunkSentences: string[] = [];
  let currentChunkLength = 0;
  let chunkIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    if (sentence.length === 0) continue;

    // Handle single sentences that are exceptionally long
    if (sentence.length > chunkSize) {
      // If we have accumulated text, save it first
      if (currentChunkSentences.length > 0) {
        chunks.push({
          content: currentChunkSentences.join(" "),
          chunkIndex: chunkIndex++,
          metadata: { pageNumber, headerPath }
        });
        currentChunkSentences = [];
        currentChunkLength = 0;
      }
      
      // Split the massive sentence into character segments
      let startIdx = 0;
      while (startIdx < sentence.length) {
        const part = sentence.substring(startIdx, startIdx + chunkSize);
        chunks.push({
          content: part,
          chunkIndex: chunkIndex++,
          metadata: { pageNumber, headerPath }
        });
        startIdx += (chunkSize - chunkOverlap);
      }
      continue;
    }

    if (currentChunkLength + sentence.length > chunkSize && currentChunkSentences.length > 0) {
      // Save current chunk
      chunks.push({
        content: currentChunkSentences.join(" "),
        chunkIndex: chunkIndex++,
        metadata: { pageNumber, headerPath }
      });

      // Calculate overlap sentences to backtrack
      const overlapSentences: string[] = [];
      let overlapLength = 0;
      
      for (let j = currentChunkSentences.length - 1; j >= 0; j--) {
        const s = currentChunkSentences[j];
        if (overlapLength + s.length > chunkOverlap) {
          break;
        }
        overlapSentences.unshift(s);
        overlapLength += s.length + 1;
      }

      currentChunkSentences = [...overlapSentences, sentence];
      currentChunkLength = overlapLength + sentence.length;
    } else {
      currentChunkSentences.push(sentence);
      currentChunkLength += (currentChunkLength > 0 ? 1 : 0) + sentence.length;
    }
  }

  // Add any remaining accumulated text
  if (currentChunkSentences.length > 0) {
    chunks.push({
      content: currentChunkSentences.join(" "),
      chunkIndex: chunkIndex++,
      metadata: { pageNumber, headerPath }
    });
  }

  return chunks;
};
