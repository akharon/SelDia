// =============================================================================
// SelDiA VS Code Extension — Activation Entry Point
// =============================================================================

import * as vscode from 'vscode';
import { createEngine } from '@seldia/core';
import type { CoreEngine } from '@seldia/core';
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { BlockDetector, type SelDiABlock } from './markdown/detector.js';
import { SelDiADecorator } from './markdown/decorator.js';
import { SelDiACodeLensProvider } from './markdown/codelens.js';
import { registerLanguageServer } from './language-server/index.js';
import { SelDiAInteractiveProvider } from './webview/provider.js';
import { SelDiAEditorProvider } from './editor/seldia-editor-provider.js';
import { createSelDiAMarkdownItPlugin } from './markdown-preview/plugin.js';
import { registerEditCommands } from './edit/commands.js';

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

  // ── Interactive Webview Editor (Phase 9c) ─────────────────────────────────
  context.subscriptions.push(
    SelDiAEditorProvider.register(context, engine)
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

  const exportMarkdownToPdf = vscode.commands.registerCommand('seldia.exportMarkdownToPdf', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.md')) {
      vscode.window.showWarningMessage('Open a .md file first');
      return;
    }
    const mdPath = editor.document.uri.fsPath;
    const pdfPath = mdPath.replace(/\.md$/, '.pdf');
    vscode.window.showInformationMessage(`$(file-pdf) PDF export configured: ${mdPath} → ${pdfPath}`);
    vscode.window.showInformationMessage('Install puppeteer for full PDF generation: npm install puppeteer');
  });

  const deploySkill = vscode.commands.registerCommand('seldia.deploySkill', async () => {
    const skillSrc = resolve(context.extensionPath, 'resources', 'skills', 'seldia-dsl', 'SKILL.md');
    if (!existsSync(skillSrc)) {
      vscode.window.showErrorMessage('Skill file not found in extension bundle');
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const choice = await vscode.window.showInformationMessage(
      'Deploy SelDiA DSL Copilot skill?',
      { modal: true, detail: 'This teaches Copilot how to write SelDiA diagrams.' },
      'Deploy to Workspace (.github/skills/)',
      'Deploy for All Workspaces (~/.copilot/skills/)',
      'Cancel'
    );

    let targetDir: string | null = null;
    if (choice?.startsWith('Deploy to Workspace') && workspaceFolders) {
      targetDir = resolve(workspaceFolders[0].uri.fsPath, '.github', 'skills', 'seldia-dsl');
    } else if (choice === 'Deploy for All Workspaces (~/.copilot/skills/)') {
      targetDir = resolve(process.env.HOME || '/home', '.copilot', 'skills', 'seldia-dsl');
    }

    if (targetDir) {
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      const targetFile = resolve(targetDir, 'SKILL.md');
      copyFileSync(skillSrc, targetFile);
      // Write manifest
      const manifest = { name: 'seldia-dsl', version: '1.0.0', deployedBy: 'seldia-vscode-ext@1.0.0', deployedAt: new Date().toISOString(), scope: choice?.includes('Workspace') ? 'workspace' : 'user', skillPath: targetFile, contentHash: 'sha256:deployed' };
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

  // ── Interactive Editor Command ────────────────────────────────────────────
  const openInteractive = vscode.commands.registerCommand('seldia.openInteractive', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
    const source = editor.document.getText();
    SelDiAInteractiveProvider.createOrShow(context.extensionUri, engine, source, editor.document.uri);
  });

  // ── Reveal Source Command (from Markdown Preview "Edit" button) ──────────
  const revealSource = vscode.commands.registerCommand('seldia.revealSource', (args?: { blockId?: string; sourceHash?: string }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      // Try to find the markdown editor from visible editors
      const mdEditor = vscode.window.visibleTextEditors.find(
        e => e.document.fileName.match(/\.(md|mdx|rst)$/)
      );
      if (!mdEditor) {
        vscode.window.showWarningMessage('No markdown editor found. Open your .md file first.');
        return;
      }
      // Focus the markdown editor
      vscode.window.showTextDocument(mdEditor.document, mdEditor.viewColumn);
      return;
    }

    if (!editor.document.fileName.match(/\.(md|mdx|rst)$/)) {
      vscode.window.showWarningMessage('Active file is not a Markdown document.');
      return;
    }

    // Find all ```seldia blocks and navigate to the one that matches
    const text = editor.document.getText();
    const lines = text.split('\n');
    const seldiaBlockRegex = /^```(seldia|seldia-\w+)/;

    for (let i = 0; i < lines.length; i++) {
      if (seldiaBlockRegex.test(lines[i])) {
        // Found a seldia block, check if it matches the hash
        const startLine = i;
        const sourceLines: string[] = [];
        i++;
        while (i < lines.length && !/^```$/.test(lines[i])) {
          sourceLines.push(lines[i]);
          i++;
        }
        const source = sourceLines.join('\n');
        const sourceHash = Math.abs(hashString(source)).toString(36);

        if (args?.sourceHash && sourceHash === args.sourceHash) {
          // Found matching block — reveal it
          const startPos = new vscode.Position(startLine, 0);
          const endPos = new vscode.Position(i, 3);
          editor.selection = new vscode.Selection(startPos, endPos);
          editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);
          return;
        }

        // Also match by blockId if present
        if (args?.blockId && args.blockId === `seldia-${sourceHash}`) {
          const startPos = new vscode.Position(startLine, 0);
          const endPos = new vscode.Position(i, 3);
          editor.selection = new vscode.Selection(startPos, endPos);
          editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);
          return;
        }
      }
    }

    vscode.window.showInformationMessage('Navigate to any ```seldia block in the editor to edit.');
  });

  // ── Register all commands ─────────────────────────────────────────────────
  context.subscriptions.push(
    toggleView, openPreview, openInteractive, insertDiagram, exportDiagram,
    exportMarkdownToPdf, deploySkill, checkSkillStatus, updateSkill, uninstallSkill,
    revealSource
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

// ── Utility: simple hash for source matching ──────────────────────────
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash;
}
