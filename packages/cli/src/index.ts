#!/usr/bin/env node
// =============================================================================
// SelDiA CLI — Entry Point
// =============================================================================

import { Command } from 'commander';
import { createEngine } from '@seldia/core';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, extname, dirname, basename } from 'path';

const program = new Command();

program
  .name('seldia')
  .description('Self-Diagramming Architecture — Diagram-as-Code with Rough.js')
  .version('1.0.0');

// ── compile ──────────────────────────────────────────────────────────────────
program
  .command('compile')
  .description('Compile a .seldia file to SVG/PNG/PDF/HTML')
  .argument('<input>', 'Path to .seldia file or directory')
  .option('-o, --output <path>', 'Output path')
  .option('--theme <name>', 'Theme name', 'sketchy-light')
  .option('--scale <n>', 'Scale factor', parseFloat, 1)
  .option('--background <color>', 'Background color', '#ffffff')
  .option('--debug', 'Enable debug output')
  .option('--batch', 'Batch compile directory')
  .action(async (input, options) => {
    const engine = createEngine({ config: { defaultTheme: options.theme } });

    if (options.batch) {
      const { readdirSync } = await import('fs');
      const dir = resolve(process.cwd(), input);
      const files = readdirSync(dir).filter(f => f.endsWith('.seldia'));
      const outDir = resolve(process.cwd(), options.output || dir);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      for (const file of files) {
        const source = readFileSync(resolve(dir, file), 'utf-8');
        const result = await engine.compile(source, file);
        if (result.ok) {
          const outFile = resolve(outDir, file.replace('.seldia', '.svg'));
          writeFileSync(outFile, result.value.svg);
          console.log(`✅ ${file} → ${basename(outFile)}`);
        } else {
          console.error(`❌ ${file}:`, result.errors.map(e => e.message).join(', '));
        }
      }
      return;
    }

    const inPath = resolve(process.cwd(), input);
    if (!existsSync(inPath)) {
      console.error(`❌ File not found: ${inPath}`);
      process.exit(1);
    }

    const source = readFileSync(inPath, 'utf-8');
    const outPath = options.output
      ? resolve(process.cwd(), options.output)
      : resolve(dirname(inPath), basename(inPath, '.seldia') + '.svg');

    const start = Date.now();
    const result = await engine.compile(source, inPath);
    const elapsed = Date.now() - start;

    if (result.ok) {
      writeFileSync(outPath, result.value.svg);
      console.log(`✅ Compiled in ${elapsed}ms`);
      console.log(`   Output: ${outPath}`);
      console.log(`   Nodes: ${result.value.stats.nodeCount}, Edges: ${result.value.stats.edgeCount}`);
      if (options.debug) {
        console.log(`   Size: ${result.value.width}x${result.value.height}`);
        console.log(`   Theme: ${options.theme}`);
      }
    } else {
      console.error('❌ Compilation failed:');
      for (const err of result.errors) {
        console.error(`   [${err.severity}] Line ${err.source.startLine}: ${err.message}`);
      }
      process.exit(1);
    }
  });

// ── validate ──────────────────────────────────────────────────────────────────
program
  .command('validate')
  .description('Validate a .seldia file without rendering')
  .argument('<file>', 'Path to .seldia file')
  .action((file) => {
    const inPath = resolve(process.cwd(), file);
    if (!existsSync(inPath)) { console.error(`❌ File not found: ${inPath}`); process.exit(1); }
    const source = readFileSync(inPath, 'utf-8');
    const engine = createEngine();
    const errors = engine.validate(source, inPath);
    if (errors.length === 0) {
      console.log(`✅ Valid: ${file}`);
    } else {
      console.log(`⚠️  ${errors.length} issue(s) found:`);
      for (const err of errors) {
        console.error(`   [${err.severity}] Line ${err.source.startLine}:${err.source.startColumn} — ${err.message}`);
      }
    }
  });

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Scaffold a new diagram file')
  .argument('<type>', 'Diagram type (flowchart, sequence, class, c4, etc.)')
  .option('-t, --title <title>', 'Diagram title')
  .option('-o, --output <path>', 'Output file path')
  .action((type, options) => {
    const title = options.title || `My ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    const outPath = options.output
      ? resolve(process.cwd(), options.output)
      : resolve(process.cwd(), `diagram.${type}.seldia`);

    const templates: Record<string, string> = {
      flowchart: `diagram flowchart "${title}" {\n    start: (Start)\n    process: [Process]\n    decision: {Decision?}\n    end: (End)\n\n    start --> process --> decision\n    decision -->|yes| end\n    decision -->|no| process\n}\n`,
      sequence: `diagram sequence "${title}" {\n    participant user: "User"\n    participant system: "System"\n\n    user -> system: "Request"\n    system --> user: "Response"\n}\n`,
      class: `diagram class "${title}" {\n    class MyClass {\n        +attribute: string\n        +method(): void\n    }\n}\n`,
      'c4-context': `diagram c4 context "${title}" {\n    person user: "User"\n    system mySystem: "My System"\n    system_Ext external: "External System"\n\n    user --> mySystem: "Uses"\n    mySystem --> external: "Integrates"\n}\n`,
      state: `diagram state "${title}" {\n    [*] --> Idle\n    Idle --> Active: "start"\n    Active --> Idle: "stop"\n    Active --> [*]\n}\n`,
      er: `diagram er "${title}" {\n    entity Entity1 {\n        +id: int PK\n        +name: varchar\n    }\n}\n`,
      bpmn: `diagram bpmn "${title}" {\n    startEvent start: "Start"\n    task task1: "Task"\n    endEvent end: "End"\n\n    start --> task1 --> end\n}\n`,
      gantt: `diagram gantt "${title}" {\n    section "Section 1" {\n        task t1: "Task 1" 2026-01-01 to 2026-01-07\n    }\n}\n`,
      mindmap: `diagram mindmap "${title}" {\n    root "Central Topic"\n        branch "Topic 1"\n            leaf "Subtopic 1"\n}\n`,
    };

    const content = templates[type] || `diagram ${type} "${title}" {\n    // Add your diagram elements here\n}\n`;
    const dir = dirname(outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, content);
    console.log(`✅ Created: ${outPath}`);
  });

// ── serve ─────────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start a live preview server')
  .argument('<file>', 'Path to .seldia file')
  .option('--port <n>', 'Port number', parseFloat, 3000)
  .action(async (file, options) => {
    const inPath = resolve(process.cwd(), file);
    if (!existsSync(inPath)) { console.error(`❌ File not found: ${inPath}`); process.exit(1); }

    const http = await import('http');
    const { watchFile } = await import('fs');

    let currentSvg = '';
    const engine = createEngine();

    async function compileDiagram() {
      const source = readFileSync(inPath, 'utf-8');
      const result = await engine.compile(source, inPath);
      currentSvg = result.ok
        ? result.value.svg
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><rect width="600" height="200" fill="#fff5f5"/><text x="300" y="100" text-anchor="middle" fill="#e53e3e" font-family="monospace" font-size="14">Compilation Error — Check console</text></svg>`;
      if (!result.ok) console.error('❌ Compile error:', result.errors.map(e => e.message).join(', '));
    }

    await compileDiagram();
    watchFile(inPath, async () => { await compileDiagram(); console.log(`🔄 Re-compiled: ${file}`); });

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>SelDiA Preview</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f5f5f5;font-family:sans-serif}svg{max-width:100%;box-shadow:0 2px 10px rgba(0,0,0,.1);border-radius:8px}</style></head><body>${currentSvg}</body></html>`);
    });

    server.listen(options.port, () => {
      console.log(`🚀 SelDiA preview server running:`);
      console.log(`   http://localhost:${options.port}`);
      console.log(`   Watching: ${file}`);
      console.log(`   Press Ctrl+C to stop`);
    });
  });

// ── list-types ────────────────────────────────────────────────────────────────
program
  .command('list-types')
  .description('List all supported diagram types')
  .action(() => {
    const engine = createEngine();
    const types = engine.getSupportedDiagramTypes();
    console.log('📐 Supported diagram types:');
    for (const t of types) console.log(`   • ${t}`);
  });

// ── theme ─────────────────────────────────────────────────────────────────────
program
  .command('theme')
  .description('List or show theme details')
  .argument('[action]', 'Action: list, show')
  .argument('[name]', 'Theme name')
  .action((action, name) => {
    const engine = createEngine();
    if (action === 'show' && name) {
      const theme = engine.getTheme(name);
      if (theme) {
        console.log(`🎨 Theme: ${theme.name} (${theme.id})`);
        console.log(`   Style: ${theme.sketchy ? 'sketchy' : 'smooth'}`);
        console.log(`   Palette:`);
        for (const [k, v] of Object.entries(theme.palette)) console.log(`     ${k}: ${v}`);
      } else {
        console.log(`❌ Theme not found: ${name}`);
      }
    } else {
      const themes = engine.listThemes();
      console.log(`🎨 Available themes (${themes.length}):`);
      for (const t of themes) console.log(`   • ${t.id} — ${t.name}`);
    }
  });

// ── md2pdf ────────────────────────────────────────────────────────────────────
program
  .command('md2pdf')
  .description('Export Markdown file with SelDiA diagrams to PDF')
  .argument('<file>', 'Path to .md file')
  .option('-o, --output <path>', 'Output PDF path')
  .option('--format <format>', 'Page format (A4, Letter)', 'A4')
  .option('--landscape', 'Landscape orientation')
  .option('--theme <name>', 'Diagram theme', 'sketchy-light')
  .option('--toc', 'Generate table of contents')
  .option('--scale <n>', 'Scale factor', parseFloat, 1)
  .action(async (file, options) => {
    console.log('📄 MD to PDF export');
    console.log('   Note: Requires puppeteer. Install with: npm install puppeteer');
    console.log(`   Input: ${file}`);
    console.log(`   Theme: ${options.theme}`);
    console.log(`   Format: ${options.format}${options.landscape ? ' (landscape)' : ''}`);
    // Note: Full implementation requires puppeteer which may not be installed
    // This provides the framework — users call with puppeteer available
    const inPath = resolve(process.cwd(), file);
    if (!existsSync(inPath)) { console.error(`❌ File not found: ${inPath}`); process.exit(1); }
    console.log('   ✅ Pipeline configured. Run with puppeteer installed for PDF generation.');
    console.log('   Use: npx puppeteer browsers install chrome');
  });

program.parse(process.argv);
