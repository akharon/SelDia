import { describe, it, expect } from 'vitest';
import { decideUpdate, isEditBlocked, formatDiagnostic } from '../src/webview/client/stale-state.js';

describe('stale-state', () => {
  it('installs svg on success', () => expect(decideUpdate({ svg: '<svg/>' }, true)).toBe('install-svg'));
  it('keeps last good on failure', () => expect(decideUpdate({}, true)).toBe('show-stale'));
  it('shows error when nothing to keep', () => expect(decideUpdate({}, false)).toBe('show-error'));
  it('blocks edits only while stale', () => {
    expect(isEditBlocked(true, 'nodeDeleted')).toBe(true);
    expect(isEditBlocked(false, 'nodeDeleted')).toBe(false);
    expect(isEditBlocked(true, 'undoRequested')).toBe(false);
  });
  it('formats line:col', () => {
    expect(formatDiagnostic({ source: { startLine: 3, startColumn: 5 } }, 'bad')).toBe('3:5: bad');
    expect(formatDiagnostic({}, 'bad')).toBe('bad');
  });
});
