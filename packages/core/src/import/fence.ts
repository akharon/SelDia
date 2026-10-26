// =============================================================================
// SelDiA — fence language -> diagram source (single source of truth)
// =============================================================================
// Every consumer that reads ```<lang> fences from Markdown (the CLI `check`
// command, the layout-metrics corpus, the VS Code preview) maps the fence
// language through this function, so a new spelling cannot silently escape a
// gate. Raw-body fences (SPICE/KiCad netlists, KiCad boards) are wrapped in a
// `circuit` / `pcb` header, which the parser splits off verbatim (parseRawBody).

export type FenceKind = 'seldia' | 'mermaid' | 'plantuml' | 'circuit' | 'pcb';

export interface FenceSource {
  /** Which compile path the text belongs to. */
  kind: FenceKind;
  /** Text the engine (seldia/circuit/pcb) or the importer (mermaid/plantuml) compiles. */
  source: string;
}

const KICAD_PCB_RE = /^\s*\(\s*kicad_pcb\b/;

/** Maps a fence language (and, for `kicad`, its body) to the source to compile.
 *  Returns null for any language that is not a diagram fence. */
export function fenceToSource(lang: string, body: string): FenceSource | null {
  switch (lang.trim().toLowerCase()) {
    case 'seldia':
      return { kind: 'seldia', source: body };
    case 'mermaid':
      return { kind: 'mermaid', source: body };
    case 'plantuml':
    case 'puml':
    case 'uml':
      return { kind: 'plantuml', source: body };
    case 'spice':
    case 'circuit':
    case 'netlist':
      return { kind: 'circuit', source: `circuit\n${body}` };
    case 'kicad':
      return KICAD_PCB_RE.test(body)
        ? { kind: 'pcb', source: `pcb\n${body}` }
        : { kind: 'circuit', source: `circuit\n${body}` };
    case 'pcb':
    case 'kicad_pcb':
      return { kind: 'pcb', source: `pcb\n${body}` };
    default:
      return null;
  }
}
