// =============================================================================
// SelDiA VS Code Extension — Activation Entry Point
// =============================================================================

import * as vscode from 'vscode';
import { createEngine, exportMermaid, isMermaidExportable, exportPlantUml, isPlantUmlExportable } from '@seldia/core';
import type { CoreEngine } from '@seldia/core';
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { BlockDetector, type SelDiABlock } from './markdown/detector.js';
import { SelDiADecorator } from './markdown/decorator.js';
import { SelDiACodeLensProvider } from './markdown/codelens.js';
import { registerLanguageServer } from './language-server/index.js';
import { SelDiAInteractiveProvider, SelDiAEditorRegistration } from './webview/provider.js';
import { createSelDiAMarkdownItPlugin } from './markdown-preview/plugin.js';
import { registerEditCommands, findDocWithBlock } from './edit/commands.js';
import { findSelDiABlocks } from './edit/blocks.js';
import { exportMarkdownToPdf as runMd2PdfPipeline } from './md2pdf/index.js';
import { isMarpDocument } from './marp/detect.js';
import { openMarpPreview } from './marp/preview-panel.js';
import { exportMarpToHtml, exportMarpToPdf } from './marp/export.js';

let engine: CoreEngine;
let skillStatusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  const layoutEngine = vscode.workspace.getConfiguration('seldia').get<'dagre' | 'elk'>('layout.engine', 'dagre');
  engine = createEngine({ config: { defaultLayoutEngine: layoutEngine } });

  console.log('SelDiA extension activated');

  // ── Skill Status Bar Item ──────────────────────────────────────────────────
  skillStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  skillStatusBarItem.command = 'seldia.checkSkillStatus';
  skillStatusBarItem.tooltip = 'SelDiA Copilot Skill — Click for details';
  refreshSkillStatusBar();
  context.subscriptions.push(skillStatusBarItem);

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
  const codeLensProvider = new SelDiACodeLensProvider();
  let activeDetector: BlockDetector | null = null;

  // Register CodeLens provider for markdown files
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'markdown', pattern: '**/*.{md,mdx}' },
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
    const isSldFile = editor.document.fileName.endsWith('.sld');
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
    if (fileName.endsWith('.sld')) {
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

  const exportMarpDeck = vscode.commands.registerCommand('seldia.exportMarp', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.match(/\.(md|mdx)$/)) {
      vscode.window.showWarningMessage('Open a Marp Markdown file first');
      return;
    }
    const markdown = editor.document.getText();
    if (!isMarpDocument(markdown)) {
      vscode.window.showWarningMessage('This file is not a Marp deck — add "marp: true" to its YAML front-matter.');
      return;
    }
    const title = editor.document.fileName.split('/').pop()?.replace(/\.(md|mdx)$/, '');
    const uri = await vscode.window.showSaveDialog({
      filters: { 'PDF': ['pdf'], 'HTML': ['html'] },
      defaultUri: vscode.Uri.file(editor.document.fileName.replace(/\.(md|mdx)$/, '.pdf')),
    });
    if (!uri) return;

    const asPdf = uri.fsPath.endsWith('.pdf');
    const result = asPdf
      ? await exportMarpToPdf(engine, markdown, uri.fsPath, title)
      : exportMarpToHtml(engine, markdown, uri.fsPath, title);

    if (!result.success) {
      vscode.window.showErrorMessage(`Marp export failed: ${result.errorMessage}`);
      return;
    }
    vscode.window.showInformationMessage(`$(check) Exported ${result.slideCount} slide(s) to ${uri.fsPath}`);
  });

  const deploySkill = vscode.commands.registerCommand('seldia.deploySkill', async () => {
    const skillSrc = resolve(context.extensionPath, 'resources', 'skills', 'seldia-dsl', 'SKILL.md');
    if (!existsSync(skillSrc)) {
      vscode.window.showErrorMessage('Skill file not found in extension bundle');
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const choice = await vscode.window.showInformationMessage(
      'Deploy SelDiA DSL skill?',
      { modal: true, detail: 'This teaches Copilot and Claude Code how to write SelDiA diagrams.' },
      'Deploy to Workspace (.github/skills/)',
      'Deploy for GitHub Copilot (~/.copilot/skills/)',
      'Deploy for Claude Code (~/.claude/skills/)',
      'Cancel'
    );

    let targetDir: string | null = null;
    if (choice?.startsWith('Deploy to Workspace') && workspaceFolders) {
      targetDir = resolve(workspaceFolders[0].uri.fsPath, '.github', 'skills', 'seldia-dsl');
    } else if (choice === 'Deploy for GitHub Copilot (~/.copilot/skills/)') {
      targetDir = resolve(process.env.HOME || '/home', '.copilot', 'skills', 'seldia-dsl');
    } else if (choice === 'Deploy for Claude Code (~/.claude/skills/)') {
      targetDir = resolve(process.env.HOME || '/home', '.claude', 'skills', 'seldia-dsl');
    }

    if (targetDir) {
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      const targetFile = resolve(targetDir, 'SKILL.md');
      copyFileSync(skillSrc, targetFile);
      // Write manifest
      const scope = choice?.includes('Workspace') ? 'workspace' : (choice?.includes('Claude') ? 'claude' : 'user');
      const manifest = { name: 'seldia-dsl', version: '1.0.0', deployedBy: 'seldia-vscode-ext@1.0.0', deployedAt: new Date().toISOString(), scope, skillPath: targetFile, contentHash: 'sha256:deployed' };
      writeFileSync(resolve(targetDir, '.sld-skill-manifest.json'), JSON.stringify(manifest, null, 2));
      vscode.window.showInformationMessage(`$(check) SelDiA DSL skill deployed to ${targetDir}`);
    }
    refreshSkillStatusBar();
  });

  const checkSkillStatus = vscode.commands.registerCommand('seldia.checkSkillStatus', () => {
    const paths = [
      { label: 'Workspace', path: vscode.workspace.workspaceFolders?.[0] ? resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, '.github', 'skills', 'seldia-dsl', 'SKILL.md') : null },
      { label: 'User', path: resolve(process.env.HOME || '/home', '.copilot', 'skills', 'seldia-dsl', 'SKILL.md') },
    ];
    let msg = '$(checklist) SelDiA Skill Status:\n';
    for (const p of paths) {
      const exists = p.path ? existsSync(p.path) : false;
      msg += `\n  ${p.label}: ${exists ? '$(check) Deployed' : '$(x) Not found'}`;
    }
    vscode.window.showInformationMessage(msg, { modal: true });
  });

  const updateSkill = vscode.commands.registerCommand('seldia.updateSkill', async () => {
    const skillSrc = resolve(context.extensionPath, 'resources', 'skills', 'seldia-dsl', 'SKILL.md');
    if (!existsSync(skillSrc)) {
      vscode.window.showErrorMessage('Skill file not found in extension bundle');
      return;
    }

    // Find existing deployments and update them
    const paths = [
      { scope: 'workspace', dir: vscode.workspace.workspaceFolders?.[0] ? resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, '.github', 'skills', 'seldia-dsl') : null },
      { scope: 'user', dir: resolve(process.env.HOME || '/home', '.copilot', 'skills', 'seldia-dsl') },
    ];

    let updatedCount = 0;
    for (const p of paths) {
      if (!p.dir) continue;
      const targetFile = resolve(p.dir, 'SKILL.md');
      if (existsSync(targetFile)) {
        copyFileSync(skillSrc, targetFile);
        const manifest = {
          name: 'seldia-dsl',
          version: '1.0.0',
          deployedBy: 'seldia-vscode-ext@1.0.0',
          deployedAt: new Date().toISOString(),
          scope: p.scope,
          skillPath: targetFile,
          contentHash: 'sha256:deployed',
        };
        writeFileSync(resolve(p.dir, '.sld-skill-manifest.json'), JSON.stringify(manifest, null, 2));
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      vscode.window.showInformationMessage(`$(check) SelDiA skill updated in ${updatedCount} location(s)`);
    } else {
      vscode.window.showInformationMessage('No existing skill deployment found to update. Use "Deploy" first.');
    }
    refreshSkillStatusBar();
  });

  const uninstallSkill = vscode.commands.registerCommand('seldia.uninstallSkill', async () => {
    const paths = [
      { scope: 'workspace', dir: vscode.workspace.workspaceFolders?.[0] ? resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, '.github', 'skills', 'seldia-dsl') : null },
      { scope: 'user', dir: resolve(process.env.HOME || '/home', '.copilot', 'skills', 'seldia-dsl') },
    ];

    // Collect existing deployments
    const existing: { scope: string; dir: string }[] = [];
    for (const p of paths) {
      if (p.dir && existsSync(resolve(p.dir, 'SKILL.md'))) {
        existing.push({ scope: p.scope, dir: p.dir });
      }
    }

    if (existing.length === 0) {
      vscode.window.showInformationMessage('No SelDiA skill deployment found to uninstall.');
      return;
    }

    const items = existing.map(e => `Remove from ${e.scope === 'workspace' ? 'Workspace' : 'User'}`);
    const choice = existing.length === 1
      ? items[0]
      : await vscode.window.showQuickPick(['All locations', ...items], {
          placeHolder: 'Select skill deployment to uninstall',
        });

    if (!choice) return;

    const confirm = await vscode.window.showWarningMessage(
      `Uninstall SelDiA DSL skill?`,
      { modal: true },
      'Uninstall'
    );
    if (confirm !== 'Uninstall') return;

    const uninstallScope = (name: string) => {
      const match = existing.find(e =>
        name.includes(e.scope === 'workspace' ? 'Workspace' : 'User')
      );
      return match || null;
    };

    let removedCount = 0;
    if (choice === 'All locations') {
      for (const e of existing) {
        try {
          const manifestPath = resolve(e.dir, '.sld-skill-manifest.json');
          if (existsSync(manifestPath)) writeFileSync(manifestPath, '');
          writeFileSync(resolve(e.dir, 'SKILL.md'), '');
          mkdirSync(e.dir, { recursive: true }); // ensure dir exists for rmdir attempt below
          removedCount++;
        } catch { /* ignore */ }
      }
    } else {
      const match = uninstallScope(choice);
      if (match) {
        try {
          const manifestPath = resolve(match.dir, '.sld-skill-manifest.json');
          if (existsSync(manifestPath)) writeFileSync(manifestPath, '');
          writeFileSync(resolve(match.dir, 'SKILL.md'), '');
          removedCount++;
        } catch { /* ignore */ }
      }
    }

    if (removedCount > 0) {
      vscode.window.showInformationMessage(`$(check) SelDiA skill uninstalled from ${removedCount} location(s)`);
    }
    refreshSkillStatusBar();
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
      SelDiAInteractiveProvider.createOrShowForBlock(context.extensionUri, engine, docUri, block);
    }
  );

  // ── Interactive Editor Command ────────────────────────────────────────────
  const openInteractive = vscode.commands.registerCommand('seldia.openInteractive', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
    const source = editor.document.getText();
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
    toggleView, openPreview, openInteractive, editBlockVisually, insertDiagram, exportDiagram,
    exportToMermaid, exportToPlantUml, exportMarkdownToPdf, deploySkill, checkSkillStatus, updateSkill, uninstallSkill,
    revealSource, openMarpPreviewCmd, exportMarpDeck, marpAutoPreviewSub
  );

  // ── Auto-deploy Copilot skill on first activation ─────────────────────────
  const wasPrompted = context.globalState.get<boolean>('seldia.skillPrompted');
  if (!wasPrompted) {
    context.globalState.update('seldia.skillPrompted', true);
    setTimeout(() => {
      vscode.window.showInformationMessage(
        'SelDiA can teach Copilot to write diagrams. Deploy DSL skill?',
        'Deploy', 'Not Now'
      ).then(choice => {
        if (choice === 'Deploy') {
          vscode.commands.executeCommand('seldia.deploySkill');
        }
      });
    }, 3000);
  }

  // ── Return extendMarkdownIt for built-in Markdown preview integration ─────
  return {
    extendMarkdownIt(md: any) {
      return createSelDiAMarkdownItPlugin(engine)(md);
    },
  };
}

// ── Skill Status Bar Refresh ─────────────────────────────────────────────────
function refreshSkillStatusBar() {
  if (!skillStatusBarItem) return;
  const homeDir = process.env.HOME || '/home';
  const wsDir = vscode.workspace.workspaceFolders?.[0]
    ? resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, '.github', 'skills', 'seldia-dsl')
    : null;
  const userSkill = resolve(homeDir, '.copilot', 'skills', 'seldia-dsl', 'SKILL.md');
  const wsSkill = wsDir ? resolve(wsDir, 'SKILL.md') : null;

  const deployed: string[] = [];
  if (existsSync(userSkill)) deployed.push('User');
  if (wsSkill && existsSync(wsSkill)) deployed.push('Workspace');

  if (deployed.length > 0) {
    skillStatusBarItem.text = `$(check) SelDiA Skill (${deployed.join(', ')})`;
    skillStatusBarItem.backgroundColor = undefined;
    skillStatusBarItem.show();
  } else {
    skillStatusBarItem.text = '$(warning) SelDiA Skill';
    skillStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    skillStatusBarItem.show();
  }
}

export function deactivate() {
  console.log('SelDiA extension deactivated');
}
