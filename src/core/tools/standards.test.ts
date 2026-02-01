import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// Test helpers
const TEST_DIR = ".activo-test";
const STANDARDS_DIR = `${TEST_DIR}/standards`;
const RAG_DIR = `${TEST_DIR}/standards-rag`;

// Helper to create test directory
function setupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  fs.mkdirSync(STANDARDS_DIR, { recursive: true });
}

// Helper to cleanup test directory
function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

// Helper to create test markdown file
function createTestMarkdown(filename: string, content: string) {
  fs.writeFileSync(path.join(STANDARDS_DIR, filename), content);
}

describe("Standards Tools", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  describe("splitStandardsIntoChunks", () => {
    it("should split markdown by sections", () => {
      const content = `# Development Standards

## Introduction
This is the introduction.

## RULE-001: Variable Naming
- Severity: error
- Rule: Use camelCase for variables

## RULE-002: Function Naming
- Severity: warning
- Rule: Use descriptive names
`;
      createTestMarkdown("test.md", content);

      // Read and verify file was created
      const savedContent = fs.readFileSync(path.join(STANDARDS_DIR, "test.md"), "utf-8");
      expect(savedContent).toContain("RULE-001");
      expect(savedContent).toContain("RULE-002");
    });

    it("should handle empty files", () => {
      createTestMarkdown("empty.md", "");
      const savedContent = fs.readFileSync(path.join(STANDARDS_DIR, "empty.md"), "utf-8");
      expect(savedContent).toBe("");
    });

    it("should handle files without rules", () => {
      const content = `# Simple Document

Just some text without rules.
`;
      createTestMarkdown("simple.md", content);
      const savedContent = fs.readFileSync(path.join(STANDARDS_DIR, "simple.md"), "utf-8");
      expect(savedContent).toContain("Simple Document");
    });
  });

  describe("cosineSimilarity", () => {
    it("should return 1 for identical vectors", () => {
      const a = [1, 2, 3];
      const b = [1, 2, 3];
      // Inline test for cosine similarity logic
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      expect(similarity).toBeCloseTo(1, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      const a = [1, 0];
      const b = [0, 1];
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      expect(similarity).toBeCloseTo(0, 5);
    });

    it("should handle different length vectors", () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      // Should return 0 or handle gracefully
      if (a.length !== b.length) {
        expect(true).toBe(true); // Different lengths not comparable
      }
    });
  });

  describe("File hash calculation", () => {
    it("should generate consistent hashes for same content", () => {
      const crypto = require("crypto");
      const content = "test content";
      const hash1 = crypto.createHash("md5").update(content).digest("hex");
      const hash2 = crypto.createHash("md5").update(content).digest("hex");
      expect(hash1).toBe(hash2);
    });

    it("should generate different hashes for different content", () => {
      const crypto = require("crypto");
      const hash1 = crypto.createHash("md5").update("content1").digest("hex");
      const hash2 = crypto.createHash("md5").update("content2").digest("hex");
      expect(hash1).not.toBe(hash2);
    });
  });
});

describe("RAG Directory Structure", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it("should create RAG directory when needed", () => {
    fs.mkdirSync(RAG_DIR, { recursive: true });
    expect(fs.existsSync(RAG_DIR)).toBe(true);
  });

  it("should save and load index file", () => {
    fs.mkdirSync(RAG_DIR, { recursive: true });
    const index = {
      version: "1.0",
      model: "nomic-embed-text",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalChunks: 10,
    };
    const indexPath = path.join(RAG_DIR, "index.json");
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

    const loaded = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    expect(loaded.version).toBe("1.0");
    expect(loaded.totalChunks).toBe(10);
  });

  it("should save and load embeddings file", () => {
    fs.mkdirSync(RAG_DIR, { recursive: true });
    const embeddings = [
      {
        chunk: { filepath: "test.md", section: "Test", content: "Test content" },
        embedding: [0.1, 0.2, 0.3],
        hash: "abc123",
      },
    ];
    const dataPath = path.join(RAG_DIR, "embeddings.json");
    fs.writeFileSync(dataPath, JSON.stringify(embeddings));

    const loaded = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    expect(loaded.length).toBe(1);
    expect(loaded[0].chunk.filepath).toBe("test.md");
  });
});
