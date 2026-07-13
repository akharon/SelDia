// =============================================================================
// SelDiA VS Code Extension — Activation Entry Point
// =============================================================================

import * as vscode from 'vscode';
import { createEngine } from '@seldia/core';
import type { CoreEngine } from '@seldia/core';
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';

let engine: CoreEngine;

export function activate(context: vscode.ExtensionContext) {
  engine = createEngine();

  console.log('🚀 SelDiA extension activated');

  // ── Commands ───────────────────────────────────────────────────────────────
  const toggleView = vscode.commands.registerCommand('seldia.toggleView', () => {
    vscode.window.showInformationMessage('SelDiA: Toggle Code / Diagram View');
  });

  const openPreview = vscode.commands.registerCommand('seldia.openPreview', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
    const panel = vscode.window.createWebviewPanel('seldiaPreview', 'SelDiA Preview', vscode.ViewColumn.Beside, { enableScripts: true });
    compileAndRender(editor.document.getText(), panel);
  });

  const insertDiagram = vscode.commands.registerCommand('seldia.insertDiagram', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    editor.edit(eb => {
      const snippet = '```seldia\ndiagram flowchart "My Diagram" {\n    start: (Start)\n    process: [Process]\n    end: (End)\n    start --> process --> end\n}\n```\n';
      eb.insert(editor.selection.active, snippet);
    });
  });

  const exportDiagram = vscode.commands.registerCommand('seldia.exportDiagram', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const source = editor.document.getText();
    const result = await engine.compile(source, editor.document.fileName);
    if (!result.ok) {
      vscode.window.showErrorMessage('Compilation failed: ' + result.errors.map(e => e.message).join(', '));
      return;
    }
    const uri = await vscode.window.showSaveDialog({ filters: { 'SVG': ['svg'] } });
    if (uri) {
      writeFileSync(uri.fsPath, result.value.svg);
      vscode.window.showInformationMessage(`✅ Exported to ${uri.fsPath}`);
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
    vscode.window.showInformationMessage(`📄 PDF export configured: ${mdPath} → ${pdfPath}`);
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
      writeFileSync(resolve(targetDir, '.seldia-skill-manifest.json'), JSON.stringify(manifest, null, 2));
      vscode.window.showInformationMessage(`✅ SelDiA DSL skill deployed to ${targetDir}`);
    }
  });

  const checkSkillStatus = vscode.commands.registerCommand('seldia.checkSkillStatus', () => {
    const paths = [
      { label: 'Workspace', path: vscode.workspace.workspaceFolders?.[0] ? resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, '.github', 'skills', 'seldia-dsl', 'SKILL.md') : null },
      { label: 'User', path: resolve(process.env.HOME || '/home', '.copilot', 'skills', 'seldia-dsl', 'SKILL.md') },
    ];
    let msg = '📋 SelDiA Skill Status:\n';
    for (const p of paths) {
      const exists = p.path ? existsSync(p.path) : false;
      msg += `\n  ${p.label}: ${exists ? '✅ Deployed' : '❌ Not found'}`;
    }
    vscode.window.showInformationMessage(msg, { modal: true });
  });

  // ── Register all commands ─────────────────────────────────────────────────
  context.subscriptions.push(
    toggleView, openPreview, insertDiagram, exportDiagram,
    exportMarkdownToPdf, deploySkill, checkSkillStatus
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
}

function compileAndRender(source: string, panel: vscode.WebviewPanel) {
  engine.compile(source).then(result => {
    if (result.ok) {
      panel.webview.html = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f5f5f5}svg{max-width:100%;box-shadow:0 2px 10px rgba(0,0,0,.1);border-radius:8px}</style></head><body>${result.value.svg}</body></html>`;
    } else {
      panel.webview.html = `<!DOCTYPE html><html><body style="padding:20px;color:#e53e3e;font-family:monospace"><h2>❌ Compilation Error</h2><pre>${result.errors.map(e => `[${e.severity}] ${e.message}`).join('\n')}</pre></body></html>`;
    }
  });
}

export function deactivate() {
  console.log('SelDiA extension deactivated');
}
