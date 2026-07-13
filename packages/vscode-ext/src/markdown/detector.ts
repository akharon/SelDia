// =============================================================================
// SelDiA — Markdown Block Detector
// =============================================================================
// Scans Markdown documents for ```seldia fenced code blocks
// and tracks them across document edits.

import * as vscode from 'vscode';

export interface SelDiABlock {
  /** Unique block ID within the document */
  id: string;

  /** 0-based index of the block in order of discovery */
  index: number;

  /** The diagram type (from language suffix or inferred) */
  diagramType: string;

  /** The full DSL source code inside the block */
  source: string;

  /** The range of the fenced code block in the document */
  range: vscode.Range;

  /** The line number of the opening fence */
  startLine: number;

  /** The line number of the closing fence */
  endLine: number;

  /** Whether this block has been rendered */
  rendered: boolean;

  /** Whether the block has compile errors */
  hasError: boolean;

  /** Error messages if any */
  errorMessage?: string;
}

export type BlockDetectionListener = (blocks: SelDiABlock[]) => void;

export class BlockDetector {
  private static readonly FENCE_PATTERN = /^```(\w*)$/;
  private static readonly SELDIA_PATTERN = /^```(seldia|seldia-(\w+))$/;
  private static readonly COMMENT_HINT = /^\/\/\s*seldia\s+(\S+)/;
  private static readonly CLOSE_FENCE = /^```$/;

  private document: vscode.TextDocument;
  private blocks: SelDiABlock[] = [];
  private listeners: BlockDetectionListener[] = [];
  private changeDisposable: vscode.Disposable | null = null;
  private debounceTimer: any = null;

  constructor(document: vscode.TextDocument) {
    this.document = document;
  }

  /**
   * Start watching the document for changes.
   */
  start(): void {
    this.scan();
    this.changeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === this.document.uri.toString()) {
        this.document = e.document;
        this.scheduleScan();
      }
    });
  }

  /**
   * Stop watching the document.
   */
  stop(): void {
    if (this.changeDisposable) {
      this.changeDisposable.dispose();
      this.changeDisposable = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Listen for block detection events.
   */
  onBlocksDetected(listener: BlockDetectionListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener.
   */
  removeListener(listener: BlockDetectionListener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * Get the currently detected blocks.
   */
  getBlocks(): SelDiABlock[] {
    return [...this.blocks];
  }

  /**
   * Get a block by its id.
   */
  getBlock(id: string): SelDiABlock | undefined {
    return this.blocks.find(b => b.id === id);
  }

  /**
   * Get block at a given position.
   */
  getBlockAtPosition(position: vscode.Position): SelDiABlock | undefined {
    return this.blocks.find(b => b.range.contains(position));
  }

  /**
   * Force a re-scan of the document.
   */
  scan(): SelDiABlock[] {
    this.blocks = this.detectBlocks();
    this.notifyListeners();
    return this.blocks;
  }

  private scheduleScan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.scan();
    }, 300); // Debounce 300ms after last edit
  }

  private detectBlocks(): SelDiABlock[] {
    const blocks: SelDiABlock[] = [];
    const text = this.document.getText();
    const lines = text.split('\n');
    let i = 0;
    let blockIndex = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Check for ```seldia fence
      const seldiaMatch = line.match(BlockDetector.SELDIA_PATTERN);
      if (seldiaMatch) {
        const diagramType = seldiaMatch[2] || 'flowchart'; // seldia-flowchart → flowchart, plain seldia → default to flowchart
        const startLine = i;
        const sourceLines: string[] = [];
        i++;

        // Collect lines until closing fence
        while (i < lines.length && !BlockDetector.CLOSE_FENCE.test(lines[i])) {
          sourceLines.push(lines[i]);
          i++;
        }

        const endLine = i; // line with ```
        const source = sourceLines.join('\n');
        const startPos = new vscode.Position(startLine, 0);
        const endPos = new vscode.Position(endLine, lines[endLine]?.length || 0);
        const range = new vscode.Range(startPos, endPos);

        blocks.push({
          id: `seldia-block-${blockIndex}`,
          index: blockIndex,
          diagramType,
          source,
          range,
          startLine,
          endLine,
          rendered: false,
          hasError: false,
        });
        blockIndex++;
        i++;
        continue;
      }

      // Check for generic fenced code block with comment hint `// seldia`
      const fenceMatch = line.match(BlockDetector.FENCE_PATTERN);
      if (fenceMatch && fenceMatch[1] === '') {
        // Generic ``` fence, check if first line inside has // seldia hint
        const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
        const hintMatch = nextLine.match(BlockDetector.COMMENT_HINT);
        if (hintMatch) {
          const diagramType = hintMatch[1];
          const startLine = i;
          const sourceLines: string[] = [];
          i += 2; // skip fence and hint line

          while (i < lines.length && !BlockDetector.CLOSE_FENCE.test(lines[i])) {
            sourceLines.push(lines[i]);
            i++;
          }

          const endLine = i;
          const source = sourceLines.join('\n');
          const startPos = new vscode.Position(startLine, 0);
          const endPos = new vscode.Position(endLine, lines[endLine]?.length || 0);
          const range = new vscode.Range(startPos, endPos);

          blocks.push({
            id: `seldia-block-${blockIndex}`,
            index: blockIndex,
            diagramType,
            source,
            range,
            startLine,
            endLine,
            rendered: false,
            hasError: false,
          });
          blockIndex++;
          i++;
          continue;
        }
      }

      i++;
    }

    return blocks;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.blocks);
    }
  }

  /**
   * Update a block's source (for visual edit round-trip).
   */
  updateBlockSource(blockId: string, newSource: string): void {
    const block = this.blocks.find(b => b.id === blockId);
    if (!block) return;

    const edit = new vscode.WorkspaceEdit();
    const uri = this.document.uri;

    // Replace the content between fences
    const contentStartLine = block.startLine + 1;
    const contentEndLine = block.endLine;
    const contentRange = new vscode.Range(
      new vscode.Position(contentStartLine, 0),
      new vscode.Position(contentEndLine, 0)
    );

    edit.replace(uri, contentRange, newSource + '\n');
    vscode.workspace.applyEdit(edit);
  }

  /**
   * Dispose the detector.
   */
  dispose(): void {
    this.stop();
    this.listeners = [];
    this.blocks = [];
  }
}
