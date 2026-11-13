// Pure decision logic for "keep the last good render" (improve.md A3 step 1).
export type StaleAction = 'install-svg' | 'show-stale' | 'show-error';

/** Edit gestures that must be ignored while the shown SVG is stale. */
export const EDIT_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'nodeAdded', 'nodeDeleted', 'edgeAdded', 'edgeDeleted', 'edgeReconnected',
  'furnitureRotated', 'requestStyleEdit', 'nodeMoved', 'labelEdited', 'nodeResized',
]);

export function decideUpdate(msg: { svg?: string }, hasGoodSvg: boolean): StaleAction {
  if (msg.svg) return 'install-svg';
  return hasGoodSvg ? 'show-stale' : 'show-error';
}

export function isEditBlocked(stale: boolean, messageType: string): boolean {
  return stale && EDIT_MESSAGE_TYPES.has(messageType);
}

/** Host-side: "line:col: message" prefix when a location is available (message pre-escaped by caller). */
export function formatDiagnostic(e: any, escapedMessage: string): string {
  const s = e?.source ?? e?.location?.start ?? e?.location ?? e;
  const line = s?.startLine ?? s?.line;
  const col = s?.startColumn ?? s?.column ?? s?.col;
  return line ? `${line}${col ? ':' + col : ''}: ${escapedMessage}` : escapedMessage;
}
