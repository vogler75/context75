import fs from 'fs';
import pdf from 'pdf-parse';
import matter from 'gray-matter';

export interface ParsedPage {
  pageNumber: number;
  content: string;
  headerPath: string[];
}

export interface ParsedDocument {
  title: string;
  rawContent: string;
  pages: ParsedPage[];
}

/**
 * Parses markdown files, extracting frontmatter title and grouping content by headings.
 */
const parseMarkdown = (filePath: string): ParsedDocument => {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(fileContent);

  const title = data.title || "";
  const pages: ParsedPage[] = [];
  
  // Split content by headings (e.g., # or ##)
  const lines = content.split('\n');
  let currentHeaderPath: string[] = [];
  let currentSectionContent: string[] = [];
  let sectionIndex = 1;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      // If we already have content accumulated, save the previous section
      if (currentSectionContent.length > 0) {
        pages.push({
          pageNumber: sectionIndex++,
          content: currentSectionContent.join('\n').trim(),
          headerPath: [...currentHeaderPath]
        });
        currentSectionContent = [];
      }

      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      // Adjust heading path based on depth level
      currentHeaderPath = currentHeaderPath.slice(0, level - 1);
      currentHeaderPath[level - 1] = headingText;
    } else {
      currentSectionContent.push(line);
    }
  }

  // Save the last section
  if (currentSectionContent.length > 0) {
    pages.push({
      pageNumber: sectionIndex,
      content: currentSectionContent.join('\n').trim(),
      headerPath: [...currentHeaderPath]
    });
  }

  // Fallback if no headings were parsed
  if (pages.length === 0) {
    pages.push({
      pageNumber: 1,
      content: content.trim(),
      headerPath: []
    });
  }

  return {
    title,
    rawContent: content,
    pages
  };
};

/**
 * Parses PDF files page by page using pdf-parse.
 */
const parsePdf = async (filePath: string): Promise<ParsedDocument> => {
  const fileBuffer = fs.readFileSync(filePath);
  
  const pages: ParsedPage[] = [];
  
  // Custom page-by-page renderer for pdf-parse
  const options = {
    pagerender: (pageData: any) => {
      // Return a JSON string mapping text to page indices, which we parse later
      return pageData.getTextContent().then((textContent: any) => {
        let lastY = -1, text = "";
        for (const item of textContent.items) {
          if (lastY === -1 || Math.abs(lastY - item.transform[5]) < 5) {
            text += (text.length > 0 ? " " : "") + item.str;
          } else {
            text += "\n" + item.str;
          }
          lastY = item.transform[5];
        }
        
        pages.push({
          pageNumber: pageData.pageIndex + 1,
          content: text.trim(),
          headerPath: [] // PDF headers are flat by default
        });
        
        return text;
      });
    }
  };

  const data = await (pdf as any)(fileBuffer, options);

  return {
    title: data.info?.Title || "",
    rawContent: data.text,
    pages: pages.sort((a, b) => a.pageNumber - b.pageNumber)
  };
};

/**
 * Router parse function to handle different file types.
 */
export const parseDocument = async (filePath: string, fileType: string): Promise<ParsedDocument> => {
  const normalizedType = fileType.toLowerCase();
  
  if (normalizedType === 'md' || normalizedType === 'mdx') {
    return parseMarkdown(filePath);
  } else if (normalizedType === 'pdf') {
    return parsePdf(filePath);
  } else {
    throw new Error(`Unsupported document file type: ${fileType}`);
  }
};
