import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";

export interface PDFPage {
  pageNumber: number;
  text: string;
}

export interface PDFParseResult {
  filename: string;
  totalPages: number;
  pages: PDFPage[];
  fullText: string;
  metadata: {
    title?: string;
    author?: string;
    creationDate?: string;
  };
}

export async function parsePDF(pdfPath: string): Promise<PDFParseResult> {
  const resolvedPath = path.resolve(pdfPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`PDF file not found: ${resolvedPath}`);
  }

  const dataBuffer = fs.readFileSync(resolvedPath);

  // Custom page renderer to capture per-page text
  const pages: PDFPage[] = [];
  let currentPage = 0;

  const options = {
    pagerender: async function (pageData: any) {
      currentPage++;
      const textContent = await pageData.getTextContent();
      const text = textContent.items
        .map((item: any) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      pages.push({
        pageNumber: currentPage,
        text: text,
      });

      return text;
    },
  };

  const data = await pdfParse(dataBuffer, options);

  return {
    filename: path.basename(pdfPath),
    totalPages: data.numpages,
    pages: pages,
    fullText: data.text,
    metadata: {
      title: data.info?.Title,
      author: data.info?.Author,
      creationDate: data.info?.CreationDate,
    },
  };
}

export function extractTextByPageRange(
  result: PDFParseResult,
  startPage: number,
  endPage: number
): string {
  return result.pages
    .filter((p) => p.pageNumber >= startPage && p.pageNumber <= endPage)
    .map((p) => p.text)
    .join("\n\n");
}
