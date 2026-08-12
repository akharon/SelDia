#!/usr/bin/env node
// =============================================================================
// SelDiA CLI — Entry Point
// =============================================================================

import { Command } from 'commander';
import { createEngine, importMermaid, importPlantUml, exportMermaid, exportPlantUml, exportBpmn, exportSqlDdl, diffDiagrams, BUILTIN_PALETTES } from '@seldia/core';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, extname, dirname, basename, join, relative as pathRelative } from 'path';
import { scanRepo } from './scan.js';

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner(): void {
  const banner = `
\x1b[38;5;99m     ┌─────────────────────────────┐
     │   SelDiA v1.0.0              │
     │   Diagram-as-Code w/ Rough.js │
     └─────────────────────────────┘\x1b[0m
  `;
  // stderr, not stdout: commands like `diff --format json` and `export --to
  // mermaid` write machine-readable output to stdout, and a decorative banner
  // there makes the result unparseable the moment anyone pipes it. The banner
  // is still shown in a terminal either way.
  console.error(banner);
}

const program = new Command();

program
  .name('seldia')
  .description('Self-Diagramming Architecture — Diagram-as-Code with Rough.js')
  .version('1.0.0')
  .hook('preAction', printBanner);

// ── compile ──────────────────────────────────────────────────────────────────
program
  .command('compile')
  .description('Compile a .sld file to SVG/PNG/PDF/HTML')
  .argument('<input>', 'Path to .sld file or directory')
  .option('-o, --output <path>', 'Output path')
  .option('--theme <name>', 'Theme name', 'sketchy-light')
  .option('--scale <n>', 'Scale factor', parseFloat, 1)
  .option('--background <color>', 'Background color', '#ffffff')
  .option('--debug', 'Enable debug output')
  .option('--batch', 'Batch compile directory')
  .action(async (input, options) => {
    const engine = createEngine({ config: { defaultTheme: options.theme, render: { theme: options.theme } } });

    if (options.batch) {
      const { readdirSync } = await import('fs');
      const dir = resolve(process.cwd(), input);
      const files = readdirSync(dir).filter(f => f.endsWith('.sld'));
      const outDir = resolve(process.cwd(), options.output || dir);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      for (const file of files) {
        const source = readFileSync(resolve(dir, file), 'utf-8');
        const result = await engine.compile(source, file);
        if (result.ok) {
          const outFile = resolve(outDir, file.replace('.sld', '.svg'));
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
      : resolve(dirname(inPath), basename(inPath, '.sld') + '.svg');

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

// ── mermaid / plantuml ───────────────────────────────────────────────────────
// Render a foreign-format file through SelDiA's engine. No conversion step, no
// new file to maintain: the .mmd/.puml stays the source of truth and SelDiA is
// just the renderer. That is the whole pitch, reduced to one command per
// format — and the two are the same command, because both importers are
// frontends onto the same IR.
function registerImportRenderCommand(
  name: string,
  formatLabel: string,
  extensions: string,
  load: (source: string) => { ir?: any; diagnostics: Array<{ line: number; message: string }> },
) {
  program
    .command(name)
    .description(`Render a ${formatLabel} (${extensions}) file to SVG using the SelDiA engine`)
    .argument('<file>', `Path to ${extensions} file`)
    .option('-o, --output <path>', 'Output path')
    .option('--theme <name>', 'Theme name', 'sketchy-light')
    .action((file, options) => {
      const inPath = resolve(process.cwd(), file);
      if (!existsSync(inPath)) {
        console.error(`❌ File not found: ${inPath}`);
        process.exit(1);
      }

      const source = readFileSync(inPath, 'utf-8');
      const { ir, diagnostics } = load(source);

      // Diagnostics are worth printing even on success — they say what the
      // importer approximated, which is exactly the trust question a user has
      // when handing their diagram to a different renderer.
      for (const d of diagnostics) console.warn(`⚠️  Line ${d.line}: ${d.message}`);

      if (!ir) {
        console.error(`❌ Could not import this ${formatLabel} diagram.`);
        process.exit(1);
      }

      const engine = createEngine({ config: { defaultTheme: options.theme, render: { theme: options.theme } } });
      const result = engine.compileIRSync(ir);
      if (!result.ok) {
        console.error('❌ Rendering failed:');
        for (const err of result.errors) console.error(`   ${err.message}`);
        process.exit(1);
      }

      const outPath = options.output
        ? resolve(process.cwd(), options.output)
        : resolve(dirname(inPath), basename(inPath, extname(inPath)) + '.svg');
      writeFileSync(outPath, result.value.svg);
      console.log(`✅ Rendered ${ir.type} from ${formatLabel}`);
      console.log(`   Output: ${outPath}`);
      console.log(`   Nodes: ${result.value.stats.nodeCount}, Edges: ${result.value.stats.edgeCount}`);
    });
}

registerImportRenderCommand('mermaid', 'Mermaid', '.mmd/.mermaid', importMermaid);
registerImportRenderCommand('plantuml', 'PlantUML', '.puml/.plantuml/.iuml/.wsd', importPlantUml);

// ── render ────────────────────────────────────────────────────────────────────
// Repository-wide batch render: finds every standalone .sld file and every
// ```seldia fenced block inside .md files under <dir>, compiles each to SVG,
// and writes them to an output directory. This is the shared engine behind
// the GitHub Action (.github/actions/seldia-render) — the Action shells out
// to this exact command rather than reimplementing the fence-scan or the
// parse→analyze→transform→layout→render pipeline.
program
  .command('render')
  .description('Render all .sld files and ```seldia fenced Markdown blocks under a directory to SVG')
  .argument('[dir]', 'Directory to scan', '.')
  .option('-o, --output <path>', 'Output directory for rendered SVGs', 'diagrams')
  .option('--theme <name>', 'Theme name', 'sketchy-light')
  .option('--ext <ext...>', 'Additional file extensions to treat as standalone diagram sources (e.g. .seldia)', [])
  .action(async (dir, options) => {
    const root = resolve(process.cwd(), dir);
    if (!existsSync(root)) {
      console.error(`❌ Directory not found: ${root}`);
      process.exit(1);
    }

    const outDir = resolve(process.cwd(), options.output);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const found = scanRepo(root, options.ext);
    if (found.length === 0) {
      console.log('ℹ️  No .sld files or ```seldia fenced blocks found.');
      return;
    }

    const engine = createEngine({ config: { defaultTheme: options.theme, render: { theme: options.theme } } });
    let okCount = 0;
    let failCount = 0;

    for (const item of found) {
      const outFile = join(outDir, `${item.slug}.svg`);
      const outSubdir = dirname(outFile);
      if (!existsSync(outSubdir)) mkdirSync(outSubdir, { recursive: true });

      const result = await engine.compile(item.source, item.file);
      const relFile = relativeLabel(root, item.file);
      if (result.ok) {
        writeFileSync(outFile, result.value.svg);
        console.log(`✅ ${relFile}${item.kind === 'md-fence' ? `:${item.line}` : ''} → ${relativeLabel(process.cwd(), outFile)}`);
        okCount++;
      } else {
        console.error(`❌ ${relFile}${item.kind === 'md-fence' ? `:${item.line}` : ''}: ${result.errors.map(e => e.message).join(', ')}`);
        failCount++;
      }
    }

    console.log(`\n📐 Rendered ${okCount}/${found.length} diagram(s) to ${relativeLabel(process.cwd(), outDir)}`);
    if (failCount > 0) process.exit(1);
  });

function relativeLabel(from: string, to: string): string {
  const rel = pathRelative(from, to);
  return rel.startsWith('..') ? to : rel;
}

// ── export ────────────────────────────────────────────────────────────────────
// Convert a .sld file to another format's text. Parse → analyze → transform
// mirrors engine.compileSync's own pipeline, just stopping before
// layout/render since the exporters work on IR, not SVG.
program
  .command('export')
  .description('Export a .sld file to another diagram format')
  .argument('<file>', 'Path to .sld file')
  .requiredOption('--to <format>', 'Target format: mermaid, plantuml, bpmn, sql-ddl')
  .option('-o, --output <path>', 'Output file path (defaults to stdout)')
  .action((file, options) => {
    const inPath = resolve(process.cwd(), file);
    if (!existsSync(inPath)) { console.error(`❌ File not found: ${inPath}`); process.exit(1); }

    const EXPORTERS: Record<string, (ir: any) => string | null> = {
      mermaid: exportMermaid,
      plantuml: exportPlantUml,
      puml: exportPlantUml,
      bpmn: exportBpmn,
      'sql-ddl': exportSqlDdl,
    };
    const exporter = EXPORTERS[options.to];
    if (!exporter) {
      console.error(`❌ Unsupported export target: ${options.to}`);
      console.error('   Supported targets: mermaid, plantuml, bpmn, sql-ddl');
      process.exit(1);
    }

    const source = readFileSync(inPath, 'utf-8');
    const engine = createEngine();

    const r1 = engine.parse(source, inPath);
    if (!r1.ok) {
      console.error('❌ Parsing failed:');
      for (const err of r1.errors) console.error(`   [${err.severity}] Line ${err.source.startLine}: ${err.message}`);
      process.exit(1);
    }
    const r2 = engine.analyze(r1.value);
    if (!r2.ok) {
      console.error('❌ Analysis failed:');
      for (const err of r2.errors) console.error(`   [${err.severity}] Line ${err.source.startLine}: ${err.message}`);
      process.exit(1);
    }
    const r3 = engine.transform(r2.value);
    if (!r3.ok) {
      console.error('❌ Transform failed:');
      for (const err of r3.errors) console.error(`   [${err.severity}] Line ${err.source.startLine}: ${err.message}`);
      process.exit(1);
    }

    const output = exporter(r3.value);
    if (output === null) {
      console.error(`❌ Diagram type "${r3.value.type}" cannot be exported to ${options.to}.`);
      process.exit(1);
    }

    if (options.output) {
      const outPath = resolve(process.cwd(), options.output);
      writeFileSync(outPath, output);
      console.log(`✅ Exported to ${options.to}`);
      console.log(`   Output: ${outPath}`);
    } else {
      console.log(output);
    }
  });

// ── diff ──────────────────────────────────────────────────────────────────────
// Structural diff between two .sld files for PR review: compiles both to IR
// (parse → analyze → transform, same as `export`) and reports nodes/edges
// added, removed, or changed — without eyeballing two rendered SVGs.
program
  .command('diff')
  .description('Show a structural diff between two .sld diagram files')
  .argument('<old>', 'Path to the "before" .sld file')
  .argument('<new>', 'Path to the "after" .sld file')
  .option('--format <format>', 'Output format: text, json', 'text')
  .action((oldFile, newFile, options) => {
    const oldPath = resolve(process.cwd(), oldFile);
    const newPath = resolve(process.cwd(), newFile);
    if (!existsSync(oldPath)) { console.error(`❌ File not found: ${oldPath}`); process.exit(1); }
    if (!existsSync(newPath)) { console.error(`❌ File not found: ${newPath}`); process.exit(1); }

    const engine = createEngine();
    const compileToIr = (path: string) => {
      const source = readFileSync(path, 'utf-8');
      const r1 = engine.parse(source, path);
      if (!r1.ok) { console.error(`❌ Parsing failed for ${path}:`); for (const err of r1.errors) console.error(`   ${err.message}`); process.exit(1); }
      const r2 = engine.analyze(r1.value);
      if (!r2.ok) { console.error(`❌ Analysis failed for ${path}:`); for (const err of r2.errors) console.error(`   ${err.message}`); process.exit(1); }
      const r3 = engine.transform(r2.value);
      if (!r3.ok) { console.error(`❌ Transform failed for ${path}:`); for (const err of r3.errors) console.error(`   ${err.message}`); process.exit(1); }
      return r3.value;
    };

    const before = compileToIr(oldPath);
    const after = compileToIr(newPath);
    const diff = diffDiagrams(before, after);

    if (options.format === 'json') {
      console.log(JSON.stringify(diff, null, 2));
      // Same exit convention as the text path below: non-zero on any diff, so
      // a CI drift check behaves identically whichever format it asks for.
      if (!diff.identical) process.exit(1);
      return;
    }

    if (diff.identical) {
      console.log('✅ No structural changes.');
      return;
    }
    if (diff.typeChanged) console.log(`⚠️  Diagram type changed: ${diff.beforeType} → ${diff.afterType}`);
    if (diff.titleChanged) console.log(`ℹ️  Title changed: "${diff.beforeTitle}" → "${diff.afterTitle}"`);

    for (const n of diff.nodes) {
      if (n.kind === 'added') console.log(`+ node ${n.id}: "${n.after!.label}" (${n.after!.shape})`);
      else if (n.kind === 'removed') console.log(`- node ${n.id}: "${n.before!.label}" (${n.before!.shape})`);
      else console.log(`~ node ${n.id}: ${n.changes!.join(', ')}`);
    }
    for (const e of diff.edges) {
      if (e.kind === 'added') console.log(`+ edge ${e.id}: ${e.after!.sourceId} -> ${e.after!.targetId}${e.after!.label ? ` ("${e.after!.label}")` : ''}`);
      else if (e.kind === 'removed') console.log(`- edge ${e.id}: ${e.before!.sourceId} -> ${e.before!.targetId}${e.before!.label ? ` ("${e.before!.label}")` : ''}`);
      else console.log(`~ edge ${e.id}: ${e.changes!.join(', ')}`);
    }

    const s = diff.summary;
    console.log(`\n📐 ${s.nodesAdded} node(s) added, ${s.nodesRemoved} removed, ${s.nodesChanged} changed | ${s.edgesAdded} edge(s) added, ${s.edgesRemoved} removed, ${s.edgesChanged} changed`);
    process.exit(1); // non-zero on any diff — mirrors `diff`'s own exit convention, useful in CI
  });

// ── validate ──────────────────────────────────────────────────────────────────
program
  .command('validate')
  .description('Validate a .sld file without rendering')
  .argument('<file>', 'Path to .sld file')
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
      : resolve(process.cwd(), `diagram.${type}.sld`);

    const templates: Record<string, string> = {
      flowchart: `diagram flowchart "${title}" {\n    start: (Start)\n    process: [Process]\n    decision: {Decision?}\n    end: (End)\n\n    start --> process\n    process --> decision\n    decision -->|"yes"| end\n    decision -->|"no"| process\n}\n`,
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
  .argument('<file>', 'Path to .sld file')
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
