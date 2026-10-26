// =============================================================================
// SelDiA — Synchronous ELK
// =============================================================================
// elkjs advertises only a Promise API, but its worker half (`elk-worker.js`)
// exports a `FakeWorker` whose dispatcher runs the layout inline and posts the
// reply synchronously. Driving that directly gives a sync `layoutSync()` that
// works in Node and in esbuild bundles (the module takes its `module.exports`
// branch whenever `document` exists or `self` does not, i.e. everywhere except
// a real Web Worker). One cached instance; algorithms registered once.
// =============================================================================

import * as workerModule from 'elkjs/lib/elk-worker.js';

export type ElkGraph = Record<string, any>;

const ALGORITHMS = ['layered', 'stress', 'mrtree', 'radial', 'force', 'disco', 'sporeOverlap', 'sporeCompaction', 'rectpacking'];

let worker: any;
let reply: { data?: any; error?: any } | undefined;
let nextId = 0;

function getWorker(): any {
  if (worker) return worker;
  const ns: any = workerModule;
  // Native Node ESM exposes module.exports as `default` ({default: FakeWorker});
  // esbuild's __esModule interop hands back the FakeWorker itself.
  const FW = ns.Worker ?? ns.default?.Worker ?? ns.default?.default ?? ns.default;
  const w = new FW();
  w.onmessage = (e: any) => { reply = e.data; };
  w.dispatcher.saveDispatch({ data: { id: -1, cmd: 'register', algorithms: ALGORITHMS } });
  worker = w;
  return w;
}

/** Lay out `graph` (ELK JSON) synchronously. Throws on any ELK error. */
export function layoutSync(graph: ElkGraph): ElkGraph {
  const w = getWorker();
  reply = undefined;
  w.dispatcher.saveDispatch({ data: { id: nextId++, cmd: 'layout', graph, layoutOptions: {}, options: {} } });
  const r = reply as { data?: any; error?: any } | undefined;
  if (!r) throw new Error('ELK produced no synchronous reply');
  if (r.error) throw new Error(typeof r.error === 'string' ? r.error : (r.error.message ?? JSON.stringify(r.error)));
  return r.data;
}

/** Promise flavour of the same engine, so async callers share one code path. */
export async function layoutAsync(graph: ElkGraph): Promise<ElkGraph> {
  return layoutSync(graph);
}
