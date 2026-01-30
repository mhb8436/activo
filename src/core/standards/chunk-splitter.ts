import { PDFParseResult } from "./pdf-parser.js";

export interface Chunk {
  id: number;
  title: string;
  content: string;
  startPage: number;
  endPage: number;
  charCount: number;
}

export interface ChunkOptions {
  maxChunkSize?: number; // Maximum characters per chunk
  minChunkSize?: number; // Minimum characters per chunk
  preferTocSplit?: boolean; // Try to split by table of contents
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChunkSize: 4000,
  minChunkSize: 500,
  preferTocSplit: true,
};

// Common Korean chapter/section patterns
const SECTION_PATTERNS = [
  /^제?\s*(\d+)\s*[장편부]\s*[.:]\s*(.+)$/m,
  /^(\d+)\.\s+(.+)$/m,
  /^([IVX]+)\.\s+(.+)$/m,
  /^(Chapter|CHAPTER)\s+(\d+)[.:]\s*(.+)$/m,
  /^(\d+)\s*[.)]\s*(.+)$/m,
];

function findSectionBreaks(text: string): Array<{ index: number; title: string }> {
  const breaks: Array<{ index: number; title: string }> = [];

  for (const pattern of SECTION_PATTERNS) {
    const regex = new RegExp(pattern.source, "gm");
    let match;

    while ((match = regex.exec(text)) !== null) {
      breaks.push({
        index: match.index,
        title: match[0].trim(),
      });
    }
  }

  // Sort by position and remove duplicates
  breaks.sort((a, b) => a.index - b.index);

  const unique: Array<{ index: number; title: string }> = [];
  for (const b of breaks) {
    if (unique.length === 0 || b.index - unique[unique.length - 1].index > 100) {
      unique.push(b);
    }
  }

  return unique;
}

function splitByToc(
  result: PDFParseResult,
  options: ChunkOptions
): Chunk[] | null {
  const fullText = result.fullText;
  const sectionBreaks = findSectionBreaks(fullText);

  if (sectionBreaks.length < 2) {
    return null; // Not enough sections found
  }

  const chunks: Chunk[] = [];

  for (let i = 0; i < sectionBreaks.length; i++) {
    const start = sectionBreaks[i].index;
    const end = i < sectionBreaks.length - 1 ? sectionBreaks[i + 1].index : fullText.length;
    const content = fullText.slice(start, end).trim();

    if (content.length < (options.minChunkSize || 100)) {
      continue;
    }

    // Find page numbers for this chunk
    let startPage = 1;
    let endPage = result.totalPages;

    let charCount = 0;
    for (const page of result.pages) {
      charCount += page.text.length;
      if (charCount >= start && startPage === 1) {
        startPage = page.pageNumber;
      }
      if (charCount >= end) {
        endPage = page.pageNumber;
        break;
      }
    }

    chunks.push({
      id: chunks.length + 1,
      title: sectionBreaks[i].title,
      content: content,
      startPage,
      endPage,
      charCount: content.length,
    });
  }

  return chunks.length >= 2 ? chunks : null;
}

function splitByPageCount(
  result: PDFParseResult,
  options: ChunkOptions
): Chunk[] {
  const chunks: Chunk[] = [];
  const maxSize = options.maxChunkSize || 4000;

  let currentChunk = "";
  let startPage = 1;
  let chunkId = 1;

  for (const page of result.pages) {
    if (currentChunk.length + page.text.length > maxSize && currentChunk.length > 0) {
      chunks.push({
        id: chunkId++,
        title: `페이지 ${startPage}-${page.pageNumber - 1}`,
        content: currentChunk.trim(),
        startPage,
        endPage: page.pageNumber - 1,
        charCount: currentChunk.length,
      });
      currentChunk = "";
      startPage = page.pageNumber;
    }
    currentChunk += page.text + "\n\n";
  }

  // Add remaining content
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: chunkId,
      title: `페이지 ${startPage}-${result.totalPages}`,
      content: currentChunk.trim(),
      startPage,
      endPage: result.totalPages,
      charCount: currentChunk.length,
    });
  }

  return chunks;
}

function splitByFixedSize(
  result: PDFParseResult,
  options: ChunkOptions
): Chunk[] {
  const chunks: Chunk[] = [];
  const maxSize = options.maxChunkSize || 4000;
  const fullText = result.fullText;

  let chunkId = 1;
  let position = 0;

  while (position < fullText.length) {
    let end = Math.min(position + maxSize, fullText.length);

    // Try to break at paragraph or sentence boundary
    if (end < fullText.length) {
      const paragraphBreak = fullText.lastIndexOf("\n\n", end);
      const sentenceBreak = fullText.lastIndexOf(". ", end);

      if (paragraphBreak > position + maxSize * 0.5) {
        end = paragraphBreak;
      } else if (sentenceBreak > position + maxSize * 0.5) {
        end = sentenceBreak + 1;
      }
    }

    const content = fullText.slice(position, end).trim();

    if (content.length > 0) {
      chunks.push({
        id: chunkId++,
        title: `청크 ${chunkId}`,
        content: content,
        startPage: 1,
        endPage: result.totalPages,
        charCount: content.length,
      });
    }

    position = end;
  }

  return chunks;
}

export function splitIntoChunks(
  result: PDFParseResult,
  options: ChunkOptions = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // For small documents (< 20 pages or < maxChunkSize), return as single chunk
  if (result.totalPages <= 20 && result.fullText.length <= (opts.maxChunkSize || 4000) * 2) {
    return [
      {
        id: 1,
        title: result.metadata.title || result.filename.replace(".pdf", ""),
        content: result.fullText,
        startPage: 1,
        endPage: result.totalPages,
        charCount: result.fullText.length,
      },
    ];
  }

  // Try TOC-based splitting first
  if (opts.preferTocSplit) {
    const tocChunks = splitByToc(result, opts);
    if (tocChunks) {
      return tocChunks;
    }
  }

  // For medium documents (20-50 pages), split by pages
  if (result.totalPages <= 50) {
    return splitByPageCount(result, opts);
  }

  // For large documents, use fixed-size splitting
  return splitByFixedSize(result, opts);
}
