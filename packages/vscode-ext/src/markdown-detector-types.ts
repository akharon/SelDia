// =============================================================================
// SelDiA VS Code Extension — Markdown Detector Interface
// =============================================================================

import type { ID } from '@seldia/core/types/common';
import type { MarkdownDiagramBlock } from './types';

// -----------------------------------------------------------------------------
// Block Detector — scans a text document for ```seldia fenced code blocks
// -----------------------------------------------------------------------------

export interface BlockDetector {
  /**
   * Scan a document's text content for all SelDiA diagram blocks.
   *
   * Detection rules:
   * 1. Fenced code blocks with language `seldia`:
   *    ```seldia
   *    diagram ...
   *    ```
   *
   * 2. Fenced code blocks with language `seldia-<type>`:
   *    ```seldia-flowchart
   *    ```
   *    (diagram type is inferred from the language suffix)
   *
   * 3. Fenced code blocks where the first line starts with `// seldia`:
   *    ```
   *    // seldia flowchart "My Title"
   *    ```
   *
   * @param documentText - The full text of the document
   * @param filePath - The file path for identification
   * @returns Array of detected diagram blocks
   */
  detectBlocks(documentText: string, filePath: string): MarkdownDiagramBlock[];

  /**
   * Detect blocks in a specific range of the document (for incremental updates).
   */
  detectBlocksInRange(
    documentText: string,
    filePath: string,
    startLine: number,
    endLine: number
  ): MarkdownDiagramBlock[];

  /**
   * Extract the DSL source from a fenced code block range.
   */
  extractDsl(documentText: string, startLine: number, endLine: number): string;

  /**
   * Determine the diagram type from the fenced code block language identifier.
   */
  inferDiagramType(languageId: string, dslSource: string): string;

  /**
   * Validate that a block contains valid SelDiA DSL (fast check, not full parse).
   */
  quickValidate(dslSource: string): { valid: boolean; diagramType?: string; title?: string };
}

// -----------------------------------------------------------------------------
// Block Manager — manages the lifecycle of detected diagram blocks
// -----------------------------------------------------------------------------

export interface BlockManager {
  /** The block detector */
  readonly detector: BlockDetector;

  /** Currently active blocks in the document */
  readonly blocks: ReadonlyMap<ID, MarkdownDiagramBlock>;

  /**
   * Scan the document and update the block registry.
   * Returns newly added, updated, and removed block IDs.
   */
  scan(documentText: string, filePath: string): BlockChanges;

  /**
   * Get a specific block by ID.
   */
  getBlock(blockId: ID): MarkdownDiagramBlock | undefined;

  /**
   * Update a block's state (e.g., toggle code/diagram view).
   */
  updateBlock(blockId: ID, patch: Partial<MarkdownDiagramBlock>): void;

  /**
   * Clear all blocks (when the document is closed).
   */
  clear(): void;

  /**
   * Subscribe to block changes.
   */
  onDidChange(callback: (changes: BlockChanges) => void): void;
}

export interface BlockChanges {
  added: ID[];
  updated: ID[];
  removed: ID[];
}
