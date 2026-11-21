// =============================================================================
// SelDiA VS Code Extension — Activation Entry Point
// =============================================================================

import * as vscode from 'vscode';
import { createEngine, exportMermaid, isMermaidExportable, exportPlantUml, isPlantUmlExportable, exportTableGfm } from '@seldia/core';
import type { CoreEngine } from '@seldia/core';
import { writeFileSync } from 'fs';
import { BlockDetector, type SelDiABlock } from './markdown/detector.js';
import { SelDiADecorator } from './markdown/decorator.js';
import { SelDiACodeLensProvider } from './markdown/codelens.js';
import { registerLanguageServer } from './language-server/index.js';
import { SelDiAInteractiveProvider, SelDiAEditorRegistration } from './webview/provider.js';
import { createSelDiAMarkdownItPlugin } from './markdown-preview/plugin.js';
import { registerEditCommands, findDocWithBlock } from './edit/commands.js';
import { findSelDiABlocks, findGfmTables, locateGfmTable, findSelDiATables, locateSelDiATable, isSelDiAFilePath } from './edit/blocks.js';
import { isSelDiATableSource } from './edit/seldia-table-patch.js';
import { SelDiATableEditorPanel } from './webview/table-provider.js';
import { exportMarkdownToPdf as runMd2PdfPipeline } from './md2pdf/index.js';
import { isMarpDocument } from './marp/detect.js';
import { openMarpPreview, MarpPreviewProvider, MARP_VIEW_TYPE } from './marp/preview-panel.js';
import { exportMarpToHtml, exportMarpToPdf } from './marp/export.js';
import { exportMarpToPptx } from './marp/pptx.js';

let engine: CoreEngine;

export function activate(context: vscode.ExtensionContext) {
  const layoutEngine = vscode.workspace.getConfiguration('seldia').get<'dagre' | 'elk'>('layout.engine', 'dagre');
  engine = createEngine({ config: { defaultLayoutEngine: layoutEngine } });

  console.log('SelDiA extension activated');

  // ── Language Server (LSP for .sld files) ─────────────────────────────────
  registerLanguageServer(context, engine);

  // ── Custom editor for .sld files (interactive diagram editor) ─────────────
  context.subscriptions.push(
    SelDiAEditorRegistration.register(context, engine)
  );

  // ── Markdown preview edit commands (drag / rename / attributes) ───────────
  registerEditCommands(context);

  // ── Markdown Detection ────────────────────────────────────────────────────
  const decorator = new SelDiADecorator(engine);
  const codeLensProvider = new SelDiACodeLensProvider(engine);
  let activeDetector: BlockDetector | null = null;

  // Register CodeLens provider for markdown files
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'markdown', scheme: 'file', pattern: '**/*.{md,mdx}' },
      codeLensProvider
    )
  );

  // Watch active editor for markdown files
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      // Clean up previous detector
      if (activeDetector) {
        activeDetector.dispose();
        activeDetector = null;
      }

      if (!editor || !editor.document.fileName.match(/\.(md|mdx|rst)$/)) return;
      if (!vscode.workspace.getConfiguration('seldia').get('markdown.enabled', true)) return;

      // Create detector for this document
      const detector = new BlockDetector(editor.document);
      activeDetector = detector;

      detector.onBlocksDetected(async (blocks) => {
        codeLensProvider.updateBlocks(blocks);
        await decorator.updateDecorations(editor, blocks);
      });

      detector.start();
    })
  );

  // Also scan the initially active editor
  if (vscode.window.activeTextEditor?.document.fileName.match(/\.(md|mdx|rst)$/)) {
    const detector = new BlockDetector(vscode.window.activeTextEditor.document);
    activeDetector = detector;
    detector.onBlocksDetected(async (blocks) => {
      codeLensProvider.updateBlocks(blocks);
      if (vscode.window.activeTextEditor) {
        await decorator.updateDecorations(vscode.window.activeTextEditor, blocks);
      }
    });
    detector.start();
  }

  // ── Commands ───────────────────────────────────────────────────────────────
  const toggleView = vscode.commands.registerCommand('seldia.toggleView', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }

    // Toggle between diagram preview and code view
    const source = editor.document.getText();
    const isSldFile = /\.(sld|seldia)$/.test(editor.document.fileName);
    if (isSldFile) {
      SelDiAInteractiveProvider.createOrShow(context.extensionUri, engine, source, editor.document.uri);
    } else if (editor.document.fileName.match(/\.(md|mdx|rst)$/)) {
      // Open the built-in markdown preview to show diagrams inline
      vscode.commands.executeCommand('markdown.showPreview');
    }
  });

  const openPreview = vscode.commands.registerCommand('seldia.openPreview', (sourceArg?: string) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor');
      return;
    }
    const fileName = editor.document.fileName;
    if (/\.(sld|seldia)$/.test(fileName)) {
      const source = editor.document.getText();
      SelDiAInteractiveProvider.createOrShow(context.extensionUri, engine, source, editor.document.uri);
    } else if (fileName.match(/\.(md|mdx|rst)$/)) {
      // Open the built-in markdown preview to show diagrams inline
      vscode.commands.executeCommand('markdown.showPreviewToSide');
    }
  });

  const insertDiagram = vscode.commands.registerCommand('seldia.insertDiagram', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    editor.edit(eb => {
      const snippet = '```seldia\ndiagram flowchart "My Diagram" {\n    start: (Start)\n    process: [Process]\n    end: (End)\n    start --> process --> end\n}\n```\n';
      eb.insert(editor.selection.active, snippet);
    });
  });

  const exportDiagram = vscode.commands.registerCommand('seldia.exportDiagram', async (sourceArg?: string) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor && !sourceArg) return;
    const source = sourceArg || editor!.document.getText();
    const result = await engine.compile(source, editor?.document.fileName);
    if (!result.ok) {
      vscode.window.showErrorMessage('Compilation failed: ' + result.errors.map(e => e.message).join(', '));
      return;
    }
    const uri = await vscode.window.showSaveDialog({ filters: { 'SVG': ['svg'], 'PNG': ['png'], 'PDF': ['pdf'] } });
    if (uri) {
      writeFileSync(uri.fsPath, result.value.svg);
      vscode.window.showInformationMessage(`$(check) Exported to ${uri.fsPath}`);
    }
  });

  // Parse → analyze → transform mirrors engine.compile's own pipeline, just
  // stopping before layout/render since the exporters work on IR, not SVG.
  // Mirrors packages/cli/src/index.ts's `export --to <format>` command. One
  // factory serves both foreign formats — they differ only in the exporter
  // function and the file extension offered in the save dialog.
  const makeExportCommand = (
    commandId: string,
    formatLabel: string,
    extension: string,
    canExport: (type: any) => boolean,
    write: (ir: any) => string | null,
  ) => vscode.commands.registerCommand(commandId, async (sourceArg?: string) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor && !sourceArg) {
      vscode.window.showWarningMessage('No active editor');
      return;
    }
    const source = sourceArg || editor!.document.getText();

    const r1 = engine.parse(source, editor?.document.fileName);
    if (!r1.ok) {
      vscode.window.showErrorMessage('Parsing failed: ' + r1.errors.map(e => e.message).join(', '));
      return;
    }
    const r2 = engine.analyze(r1.value);
    if (!r2.ok) {
      vscode.window.showErrorMessage('Analysis failed: ' + r2.errors.map(e => e.message).join(', '));
      return;
    }
    const r3 = engine.transform(r2.value);
    if (!r3.ok) {
      vscode.window.showErrorMessage('Transform failed: ' + r3.errors.map(e => e.message).join(', '));
      return;
    }

    const text = canExport(r3.value.type) ? write(r3.value) : null;
    if (text === null) {
      vscode.window.showErrorMessage(`Diagram type "${r3.value.type}" cannot be exported to ${formatLabel}.`);
      return;
    }

    const uri = await vscode.window.showSaveDialog({ filters: { [formatLabel]: [extension] } });
    if (uri) {
      writeFileSync(uri.fsPath, text);
      vscode.window.showInformationMessage(`$(check) Exported to ${uri.fsPath}`);
    }
  });

  const exportToMermaid = makeExportCommand('seldia.exportToMermaid', 'Mermaid', 'mmd', isMermaidExportable, exportMermaid);
  const exportToPlantUml = makeExportCommand('seldia.exportToPlantUml', 'PlantUML', 'puml', isPlantUmlExportable, exportPlantUml);
  // A SelDiA `table` → plain GFM pipe table. Lossy: merged cells become an
  // anchor plus empty cells (GFM has no spans) and a chart directive is dropped.
  const exportTableToMarkdown = makeExportCommand('seldia.exportTableToMarkdown', 'Markdown', 'md', (t) => t === 'table', exportTableGfm);

  const exportMarkdownToPdf = vscode.commands.registerCommand('seldia.exportMarkdownToPdf', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.md')) {
      vscode.window.showWarningMessage('Open a .md file first');
      return;
    }
    const mdPath = editor.document.uri.fsPath;
    const uri = await vscode.window.showSaveDialog({
      filters: { 'PDF': ['pdf'] },
      defaultUri: vscode.Uri.file(mdPath.replace(/\.md$/, '.pdf')),
    });
    if (!uri) return;

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Exporting Markdown to PDF', cancellable: false },
      (progress) => runMd2PdfPipeline(
        editor.document.getText(),
        {
          inputPath: mdPath,
          outputPath: uri.fsPath,
          theme: vscode.workspace.getConfiguration('seldia').get<string>('defaultTheme', 'sketchy-light'),
        },
        engine
      ).then((r) => {
        progress.report({ increment: 100 });
        return r;
      })
    );

    if (!result.success) {
      const message = result.errors?.map(e => e.message).join('; ') || 'Unknown error';
      vscode.window.showErrorMessage(`PDF export failed: ${message}`);
      return;
    }

    const failedNote = result.failedDiagrams.length > 0
      ? ` (${result.failedDiagrams.length} diagram(s) failed to render)`
      : '';
    vscode.window.showInformationMessage(`$(check) Exported to ${result.outputPath}${failedNote}`);
  });

  // Marp decks (```marp: true``` front-matter) are page-based, not a linear
  // scrolling document, so they get their own slide-by-slide preview panel
  // instead of the built-in Markdown preview — see marp/preview-panel.ts.
  // Registered as a CustomTextEditorProvider (viewType seldia.marpPreview) so
  // it shows up as "Marp Preview" in the "Reopen Editor With" picker alongside
  // "Markdown Preview" and "Markdown Editor (Experimental)".
  const marpProviderSub = vscode.window.registerCustomEditorProvider(
    MARP_VIEW_TYPE,
    new MarpPreviewProvider(engine, context.extensionUri),
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  const openMarpPreviewCmd = vscode.commands.registerCommand('seldia.openMarpPreview', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.match(/\.(md|mdx)$/)) {
      vscode.window.showWarningMessage('Open a Marp Markdown file first (front-matter must set marp: true)');
      return;
    }
    if (!isMarpDocument(editor.document.getText())) {
      vscode.window.showWarningMessage('This file is not a Marp deck — add "marp: true" to its YAML front-matter.');
      return;
    }
    openMarpPreview(context, engine, editor.document);
  });

  // VS Code's built-in Markdown preview renders a Marp deck as one long
  // scrolling document, which looks identical to any other .md file and hides
  // the fact that the deck is paginated. Opening a `marp: true` document
  // therefore brings up the slide panel automatically (opt-out via
  // `seldia.marp.autoPreview`). The built-in preview is deliberately left
  // registered — this adds a panel beside it rather than replacing it.
  const autoOpenMarp = (doc: vscode.TextDocument) => {
    if (!vscode.workspace.getConfiguration('seldia').get<boolean>('marp.autoPreview', true)) return;
    if (doc.languageId !== 'markdown' || doc.uri.scheme !== 'file') return;
    if (!isMarpDocument(doc.getText())) return;
    openMarpPreview(context, engine, doc, true);
  };
  const marpAutoPreviewSub = vscode.workspace.onDidOpenTextDocument(autoOpenMarp);
  // onDidOpenTextDocument does not fire for documents already open when the
  // extension activates, so sweep the current editors once on startup.
  for (const editor of vscode.window.visibleTextEditors) autoOpenMarp(editor.document);

  const exportMarpDeck = vscode.commands.registerCommand('seldia.exportMarp', async (target?: vscode.Uri) => {
    const docUri = target ?? vscode.window.activeTextEditor?.document.uri;
    if (!docUri || !docUri.fsPath.match(/\.(md|mdx)$/)) {
      vscode.window.showWarningMessage('Open a Marp Markdown file first');
      return;
    }
    const document = await vscode.workspace.openTextDocument(docUri);
    const markdown = document.getText();
    if (!isMarpDocument(markdown)) {
      vscode.window.showWarningMessage('This file is not a Marp deck — add "marp: true" to its YAML front-matter.');
      return;
    }
    const title = docUri.fsPath.split('/').pop()?.replace(/\.(md|mdx)$/, '');
    const uri = await vscode.window.showSaveDialog({
      filters: { 'PDF': ['pdf'], 'PowerPoint': ['pptx'], 'HTML': ['html'] },
      defaultUri: vscode.Uri.file(docUri.fsPath.replace(/\.(md|mdx)$/, '.pdf')),
    });
    if (!uri) return;

    // PPTX and PDF both drive headless Chrome and can take a while on a long
    // deck, so they run under a progress notification; HTML is a direct write.
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting Marp deck…',
        cancellable: false,
      },
      async (progress) => {
        // The first export on a fresh install downloads Chrome, which takes
        // minutes; without this the notification sits on its generic title.
        const onProgress = (message: string) => progress.report({ message });
        if (uri.fsPath.endsWith('.pptx')) {
          return exportMarpToPptx(engine, markdown, uri.fsPath, title, { onProgress });
        }
        if (uri.fsPath.endsWith('.pdf')) {
          return exportMarpToPdf(engine, markdown, uri.fsPath, title, onProgress);
        }
        return exportMarpToHtml(engine, markdown, uri.fsPath, title);
      }
    );

    if (!result.success) {
      vscode.window.showErrorMessage(`Marp export failed: ${result.errorMessage}`);
      return;
    }
    vscode.window.showInformationMessage(`$(check) Exported ${result.slideCount} slide(s) to ${uri.fsPath}`);
  });

  // ── Edit a Markdown fence visually (Option B: CodeLens → block editor) ────
  // Opens the interactive editor targeted at ONE ```seldia fence. The raw
  // Markdown stays the source of truth: drags/label edits/adds/deletes become
  // WorkspaceEdits on the fence's range, visible live in the text editor and
  // undoable with its native undo. This never touches the read-only Markdown
  // preview channel (see edit/commands.ts for why that stays navigation-only).
  const editBlockVisually = vscode.commands.registerCommand(
    'seldia.editBlockVisually',
    async (args?: { doc?: string; blockId?: string }) => {
      // Invoked from a CodeLens with {doc, blockId}; also usable from the
      // palette on an active Markdown editor (first block at/after cursor).
      let docUri: vscode.Uri | undefined;
      let blockId: string | undefined = args?.blockId;
      if (args?.doc) {
        docUri = vscode.Uri.parse(args.doc);
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !/\.(md|mdx|rst)$/.test(editor.document.fileName)) {
          vscode.window.showWarningMessage('Open a Markdown file with a ```seldia block first.');
          return;
        }
        docUri = editor.document.uri;
      }
      const doc = await vscode.workspace.openTextDocument(docUri);
      const blocks = findSelDiABlocks(doc.getText());
      if (!blocks.length) {
        vscode.window.showWarningMessage('No ```seldia blocks found in this document.');
        return;
      }
      let block = blockId ? blocks.find((b) => b.blockId === blockId) : undefined;
      if (!block && !blockId) {
        // Palette path: nearest block at/after the cursor, else the first.
        const line = vscode.window.activeTextEditor?.selection.active.line ?? 0;
        block = blocks.find((b) => b.sourceEndLine >= line) ?? blocks[0];
      }
      if (!block) {
        vscode.window.showWarningMessage('SelDiA: could not locate this diagram block (it may have changed).');
        return;
      }
      // A `table` diagram has no canvas to drag — it opens in the table editor.
      if (isSelDiATableSource(block.source)) {
        await vscode.commands.executeCommand('seldia.editTable', { doc: docUri.toString(), kind: 'seldia', tableId: block.blockId, line: block.sourceStartLine });
        return;
      }
      SelDiAInteractiveProvider.createOrShowForBlock(context.extensionUri, engine, docUri, block);
    }
  );

  // ── Edit a GFM table (CodeLens / preview toolbar deep link / palette) ─────
  // Same document contract as revealSource/editBlockVisually: `args.doc` is
  // authoritative (stamped from env.currentDocument by the preview plugin, or
  // from the CodeLens' own document); only the palette path falls back to the
  // active editor. The table is found by id (hash of its source lines), then
  // by its start line — the preview's id goes stale as soon as the source is
  // edited, and the line is what still points at the right table.
  const editTable = vscode.commands.registerCommand(
    'seldia.editTable',
    async (args?: { doc?: string; tableId?: string; line?: string | number; kind?: 'gfm' | 'seldia' }) => {
      let docUri: vscode.Uri;
      let line = args?.line !== undefined && args.line !== '' ? Number(args.line) : NaN;
      if (args?.doc) {
        docUri = vscode.Uri.parse(args.doc);
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !/\.(md|mdx|seldia|sld)$/i.test(editor.document.fileName)) {
          vscode.window.showWarningMessage('Open a Markdown file with a table (or a SelDiA table file) first.');
          return;
        }
        docUri = editor.document.uri;
        if (Number.isNaN(line)) line = editor.selection.active.line;
      }
      const doc = await vscode.workspace.openTextDocument(docUri);
      const text = doc.getText();
      // SelDiA `table` diagrams: a whole .seldia/.sld file, an explicit
      // `kind: 'seldia'` (CodeLens), or — from the palette — a fence the cursor is in.
      const wholeFile = isSelDiAFilePath(docUri.path);
      let st = wholeFile || args?.kind === 'seldia'
        ? locateSelDiATable(text, wholeFile, args?.tableId, Number.isNaN(line) ? -1 : line, args?.tableId ? 3 : 0)
        : undefined;
      if (!st && !args?.doc && !Number.isNaN(line)) {
        st = findSelDiATables(text, wholeFile).find((t) => line >= t.startLine - 1 && line <= t.endLine);
      }
      if (st) { SelDiATableEditorPanel.createOrShow(context.extensionUri, docUri, st, 'seldia'); return; }
      if (wholeFile || args?.kind === 'seldia') {
        vscode.window.showWarningMessage('SelDiA: no `table` diagram found here (it may have changed).');
        return;
      }
      let table = locateGfmTable(text, args?.tableId, Number.isNaN(line) ? -1 : line, args?.tableId ? 3 : 0);
      if (!table && !args?.tableId && !Number.isNaN(line)) {
        // Palette: the table containing the cursor, else the next one below it.
        const tables = findGfmTables(text);
        table = tables.find((t) => line >= t.startLine && line < t.endLine) ?? tables.find((t) => t.startLine >= line);
      }
      if (!table) {
        vscode.window.showWarningMessage('SelDiA: could not locate this table in its Markdown source (it may have changed).');
        return;
      }
      SelDiATableEditorPanel.createOrShow(context.extensionUri, docUri, table);
    }
  );

  // ── Interactive Editor Command ────────────────────────────────────────────
  const openInteractive = vscode.commands.registerCommand('seldia.openInteractive', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
    const source = editor.document.getText();
    if (isSelDiAFilePath(editor.document.uri.path) && isSelDiATableSource(source)) {
      void vscode.commands.executeCommand('seldia.editTable', { doc: editor.document.uri.toString(), kind: 'seldia', line: 0 });
      return;
    }
    SelDiAInteractiveProvider.createOrShow(context.extensionUri, engine, source, editor.document.uri);
  });

  // ── Reveal Source Command (from the Markdown preview toolbar) ────────────
  // Invoked via the `vscode://` deep link the preview stamps on its "open in
  // editor" anchors, so `args.doc` carries the Uri of the document the preview
  // rendered the block from. That Uri is what makes this reliable: while the
  // preview has focus there is no active text editor to consult, and the
  // document need not be open in any editor at all.
  const revealSource = vscode.commands.registerCommand(
    'seldia.revealSource',
    async (args?: { blockId?: string; doc?: string }) => {
      if (!args?.blockId) return;
      const found = await findDocWithBlock(args.blockId, args.doc);
      if (!found) {
        vscode.window.showWarningMessage('SelDiA: could not locate this diagram block in its Markdown source.');
        return;
      }
      const { doc, block } = found;
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
      });
      const start = new vscode.Position(block.fenceLine, 0);
      const end = new vscode.Position(block.sourceEndLine, doc.lineAt(Math.min(block.sourceEndLine, doc.lineCount - 1)).text.length);
      editor.selection = new vscode.Selection(start, end);
      editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
    }
  );

  // ── Register all commands ─────────────────────────────────────────────────
  context.subscriptions.push(
    toggleView, openPreview, openInteractive, editBlockVisually, editTable, insertDiagram, exportDiagram,
    exportToMermaid, exportToPlantUml, exportTableToMarkdown, exportMarkdownToPdf,
    revealSource, marpProviderSub, openMarpPreviewCmd, exportMarpDeck, marpAutoPreviewSub
  );

  // ── Return extendMarkdownIt for built-in Markdown preview integration ─────
  // Config is read once here, at plugin-construction time — never per token
  // inside the hot renderer rule. A change to seldia.markdown.captions.enabled
  // takes effect on the next preview refresh, triggered below.
  const captionsEnabled = vscode.workspace.getConfiguration('seldia').get<boolean>('markdown.captions.enabled', true);
  const tocEnabled = vscode.workspace.getConfiguration('seldia').get<boolean>('markdown.toc.enabled', true);
  // Tables are read lazily (once per rendered table, not per token) so the
  // setting applies on the next refresh without re-creating the plugin.
  const tablesEnabled = () => vscode.workspace.getConfiguration('seldia').get<boolean>('markdown.tables.enabled', true);
  const seldiaMarkdownItPlugin = createSelDiAMarkdownItPlugin(engine, { captionsEnabled, tocEnabled, tablesEnabled });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('seldia.markdown.captions.enabled') ||
        e.affectsConfiguration('seldia.markdown.toc.enabled') ||
        e.affectsConfiguration('seldia.markdown.tables.enabled')
      ) {
        vscode.commands.executeCommand('markdown.preview.refresh');
      }
    })
  );

  return {
    extendMarkdownIt(md: any) {
      return seldiaMarkdownItPlugin(md);
    },
  };
}

export function deactivate() {
  console.log('SelDiA extension deactivated');
}
