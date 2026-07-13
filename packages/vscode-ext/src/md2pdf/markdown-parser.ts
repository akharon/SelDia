// =============================================================================
// SelDiA — MD→PDF Markdown Parser (marked custom renderer)
// =============================================================================
// Custom marked renderer that intercepts ```seldia fenced code blocks
// and replaces them with diagram placeholders.

import { marked } from 'marked';

export interface DetectedBlock {
  /** 0-based index of this block in the document */
  index: number;
  /** The raw DSL source from the fenced code block */
  dslSource: string;
  /** The diagram type (inferred from language suffix or parsed from DSL) */
  diagramType: string;
  /** The language identifier used in the fenced block */
  language: string;
  /** Raw text including the ``` fence markers */
  raw: string;
}

export interface ParseResult {
  /** The HTML with placeholder markers */
  html: string;
  /** All detected SelDiA blocks */
  blocks: DetectedBlock[];
}

/**
 * Parse a Markdown string using marked, intercepting ```seldia blocks.
 */
export function parseMarkdown(markdown: string): ParseResult {
  const blocks: DetectedBlock[] = [];
  let blockIndex = 0;

  // First pass: extract all ```seldia blocks
  const blockRegex = /```(seldia[\w-]*)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  const placeholders: Map<string, DetectedBlock> = new Map();

  while ((match = blockRegex.exec(markdown)) !== null) {
    const language = match[1].trim();
    const dslSource = match[2].trim();

    // Infer diagram type from language suffix (e.g., seldia-flowchart → flowchart)
    let diagramType = 'flowchart';
    if (language.startsWith('seldia-')) {
      diagramType = language.slice(7);
    } else {
      // Try to parse from the DSL source
      const typeMatch = dslSource.match(/^\s*diagram\s+(\S+)/);
      if (typeMatch) diagramType = typeMatch[1];
    }

    const block: DetectedBlock = {
      index: blockIndex++,
      dslSource,
      diagramType,
      language,
      raw: match[0],
    };

    const placeholder = `<!--SELDIA_BLOCK_${block.index}-->`;
    placeholders.set(placeholder, block);
    blocks.push(block);
  }

  // Set up marked with custom renderer
  const renderer = new marked.Renderer();

  // Intercept code blocks
  const origCode = renderer.code.bind(renderer);
  (renderer as any).code = (token: any) => {
    const text = token.text || '';
    const lang = token.lang || '';
    if (lang.startsWith('seldia')) {
      // Find the matching block by matching text
      const block = blocks.find(b => b.dslSource === text.trim() && b.language === lang);
      if (block) {
        return `<!--SELDIA_BLOCK_${block.index}-->\n`;
      }
    }
    return origCode(token);
  };

  marked.setOptions({
    renderer,
    gfm: true,
    breaks: false,
  } as any);

  // Parse markdown to HTML
  const html = marked.parse(markdown) as string;

  return { html, blocks };
}
