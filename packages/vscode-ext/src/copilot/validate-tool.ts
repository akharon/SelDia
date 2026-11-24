// =============================================================================
// SelDiA — Copilot language model tool: seldia_validate
// =============================================================================
// Lets Copilot (agent mode) check SelDiA, Mermaid and PlantUML diagrams itself
// and fix what it finds, without a skill or MCP server. Declared under
// `contributes.languageModelTools` in package.json; the validation logic is
// core `validateDocument` (shared, tested there).

import * as vscode from 'vscode';
import { validateDocument, languageForPath, formatValidationReport, type CoreEngine } from '@seldia/core';

export const VALIDATE_TOOL = 'seldia_validate';

export interface ValidateToolInput {
  /** Absolute or workspace-relative path of a .sld/.md/.mmd/.puml/... file. */
  filePath?: string;
  /** Diagram source to validate directly instead of a file. */
  code?: string;
  /** seldia | mermaid | plantuml | circuit | pcb | markdown. Defaults from the file extension, else seldia. */
  language?: string;
  /** Also report layout readability defects (crossings, overlaps) with fix hints. */
  layout?: boolean;
}

const LANGUAGE_IDS: Record<string, string> = { seldia: 'seldia', markdown: 'markdown', mermaid: 'mermaid', plantuml: 'plantuml' };

async function resolveFile(filePath: string): Promise<vscode.Uri> {
  if (/^[a-z]:[\\/]|^[\\/]/i.test(filePath)) return vscode.Uri.file(filePath);
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(folder.uri, filePath);
    try { await vscode.workspace.fs.stat(uri); return uri; } catch { /* try next folder */ }
  }
  throw new Error(`File not found: ${filePath}`);
}

/** Text of a file, preferring an open editor's (possibly unsaved) buffer. */
async function readText(uri: vscode.Uri): Promise<{ text: string; languageId?: string }> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return { text: open.getText(), languageId: open.languageId };
  const bytes = await vscode.workspace.fs.readFile(uri);
  return { text: new TextDecoder().decode(bytes) };
}

export async function runValidateTool(engine: CoreEngine, input: ValidateToolInput): Promise<string> {
  const layout = !!input.layout;
  if (input.code !== undefined) {
    const lang = (input.language ?? 'seldia').toLowerCase();
    return formatValidationReport(await validateDocument(engine, input.code, lang, { layout }), '<code>');
  }

  let uri: vscode.Uri;
  if (input.filePath) uri = await resolveFile(input.filePath);
  else {
    const active = vscode.window.activeTextEditor?.document;
    if (!active) return 'No filePath or code given and no active editor. Pass filePath (a .sld, .md, .mmd or .puml file) or code + language.';
    uri = active.uri;
  }
  const { text, languageId } = await readText(uri);
  const lang = (input.language
    ?? languageForPath(uri.path)
    ?? (languageId && LANGUAGE_IDS[languageId])
    ?? 'seldia').toLowerCase();
  const name = vscode.workspace.asRelativePath(uri, false);
  return formatValidationReport(await validateDocument(engine, text, lang, { layout }), name);
}

export function registerValidateTool(context: vscode.ExtensionContext, engine: CoreEngine): void {
  // Older hosts (or no Copilot) have no lm.registerTool: the tool is optional.
  if (typeof vscode.lm?.registerTool !== 'function') return;
  const tool: vscode.LanguageModelTool<ValidateToolInput> = {
    prepareInvocation(options) {
      const what = options.input.code !== undefined ? `${options.input.language ?? 'seldia'} code`
        : options.input.filePath ?? 'the active editor';
      return { invocationMessage: `Validating diagrams in ${what}` };
    },
    async invoke(options) {
      let text: string;
      try { text = await runValidateTool(engine, options.input); }
      catch (e) { text = `Error: ${(e as Error)?.message ?? e}`; }
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    },
  };
  context.subscriptions.push(vscode.lm.registerTool(VALIDATE_TOOL, tool));
}
