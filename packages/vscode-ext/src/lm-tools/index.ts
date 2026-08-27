// =============================================================================
// SelDiA — Language Model Tools (GitHub Copilot agent-mode integration)
// =============================================================================
// Registers SelDiA's compile/validate pipeline as vscode.lm tools so Copilot's
// agent mode (and any other extension consuming the Language Model Tools API)
// can render and validate SelDiA diagrams without a human going through the
// command palette. This is a second, parallel integration to the SKILL.md
// deployment in ../skill — the skill teaches Copilot Chat's *text* model how
// to author the DSL; these tools give the *agent* an actual callable that
// returns a real render/diagnostics result instead of asking the model to
// simulate one.
// =============================================================================

import * as vscode from 'vscode';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CoreEngine } from '@seldia/core';

interface RenderDiagramInput {
  source: string;
  fileName?: string;
}

interface ValidateDiagramInput {
  source: string;
  fileName?: string;
}

/** Renders SelDiA DSL source to SVG and writes it to a temp file, since the
 *  Language Model Tools API returns text parts to the model — handing back a
 *  file path (rather than the raw SVG markup) keeps the response small and
 *  lets Copilot open/insert it as a real file. */
class RenderDiagramTool implements vscode.LanguageModelTool<RenderDiagramInput> {
  constructor(private engine: CoreEngine) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RenderDiagramInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { source, fileName } = options.input;
    const result = await this.engine.compile(source, fileName);
    if (!result.ok) {
      const message = result.errors.map((e) => e.message).join('; ');
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Compilation failed: ${message}`),
      ]);
    }

    const dir = mkdtempSync(join(tmpdir(), 'seldia-'));
    const svgPath = join(dir, 'diagram.svg');
    writeFileSync(svgPath, result.value.svg);

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `Rendered diagram (${result.value.width}x${result.value.height}px, ` +
          `${result.value.stats.nodeCount} nodes, ${result.value.stats.edgeCount} edges) ` +
          `to ${svgPath}`
      ),
    ]);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RenderDiagramInput>
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: 'Rendering SelDiA diagram',
      confirmationMessages: undefined,
    };
  }
}

/** Parses + analyzes source without rendering, returning diagnostics as
 *  plain text — used by Copilot for a tight generate/check/fix loop while
 *  authoring a diagram, without paying for a full layout+render pass. */
class ValidateDiagramTool implements vscode.LanguageModelTool<ValidateDiagramInput> {
  constructor(private engine: CoreEngine) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ValidateDiagramInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { source, fileName } = options.input;
    const diagnostics = this.engine.validate(source, fileName);
    if (diagnostics.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart('Valid — no errors found.'),
      ]);
    }
    const summary = diagnostics
      .map((d) => `[${d.severity}] line ${d.source.startLine}: ${d.message}${d.code ? ` (${d.code})` : ''}`)
      .join('\n');
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(summary),
    ]);
  }
}

/** Returns the engine's registered diagram type keywords — lets Copilot pick
 *  a valid `diagram <type> "..."` header instead of guessing or hallucinating
 *  one when generating a new diagram from scratch. */
class ListDiagramTypesTool implements vscode.LanguageModelTool<Record<string, never>> {
  constructor(private engine: CoreEngine) {}

  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const types = this.engine.getSupportedDiagramTypes();
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(types.join(', ')),
    ]);
  }
}

/** Registers all SelDiA Language Model Tools with VS Code. Tool names must
 *  match the `languageModelTools` contributions in package.json exactly. */
export function registerLanguageModelTools(
  context: vscode.ExtensionContext,
  engine: CoreEngine
): void {
  context.subscriptions.push(
    vscode.lm.registerTool('seldia_renderDiagram', new RenderDiagramTool(engine)),
    vscode.lm.registerTool('seldia_validateDiagram', new ValidateDiagramTool(engine)),
    vscode.lm.registerTool('seldia_listDiagramTypes', new ListDiagramTypesTool(engine))
  );
}
