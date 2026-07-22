// DOM tests for the three SelDiA custom elements, running under happy-dom.
// The key regression guarded here: compiled SVG must land in the shadow DOM as
// real elements (via unsafeHTML), not as escaped text — and compile errors /
// fetch failures must come back escaped, never as live markup.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

const VALID_DSL = `diagram flowchart "T" {\n  a: (Start)\n  b: [Step]\n  a -> b\n}`;
const INVALID_DSL = `diagram flowchart "T" {\n  a -> \n}`;

beforeAll(async () => {
  await import('../src/index.js');
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function settle(el: HTMLElement & { updateComplete: Promise<unknown> }) {
  // compile() is async and calls requestUpdate() when done; wait a couple of
  // microtask/frame rounds so both the compile and the re-render land.
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
}

describe('<seldia-viewer>', () => {
  it('renders compiled SVG as real elements in the shadow DOM', async () => {
    const el = document.createElement('seldia-viewer') as any;
    el.dsl = VALID_DSL;
    document.body.appendChild(el);
    await settle(el);
    const svg = el.shadowRoot!.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(el.shadowRoot!.textContent).not.toContain('<svg'); // not escaped text
  });

  it('shows an error box (not an SVG) for a compile failure', async () => {
    const el = document.createElement('seldia-viewer') as any;
    el.dsl = INVALID_DSL;
    document.body.appendChild(el);
    await settle(el);
    expect(el.shadowRoot!.querySelector('svg')).toBeNull();
    expect(el.shadowRoot!.querySelector('.error')).toBeTruthy();
  });

  it('fetches src when dsl is empty and renders the result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => VALID_DSL })));
    const el = document.createElement('seldia-viewer') as any;
    el.src = '/diagram.sld';
    document.body.appendChild(el);
    await settle(el);
    expect(fetch).toHaveBeenCalledWith('/diagram.sld');
    expect(el.shadowRoot!.querySelector('svg')).toBeTruthy();
  });

  it('escapes the src URL in the fetch-failure message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    const el = document.createElement('seldia-viewer') as any;
    el.src = '/x<img src=x onerror=alert(1)>.sld';
    document.body.appendChild(el);
    await settle(el);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('.error')!.textContent).toContain('Failed to load');
  });

  it('renders nothing when both dsl and src are empty', async () => {
    const el = document.createElement('seldia-viewer') as any;
    document.body.appendChild(el);
    await settle(el);
    expect(el.shadowRoot!.querySelector('svg')).toBeNull();
    expect(el.shadowRoot!.querySelector('.error')).toBeNull();
  });
});

describe('<seldia-editor>', () => {
  it('compiles the textarea value on ▶ Compile and shows the SVG', async () => {
    const el = document.createElement('seldia-editor') as any;
    el.value = VALID_DSL;
    document.body.appendChild(el);
    await settle(el);
    const btn = el.shadowRoot!.querySelector('button')!;
    btn.click();
    await settle(el);
    expect(el.shadowRoot!.querySelector('svg')).toBeTruthy();
    expect(el.shadowRoot!.querySelector('.status')!.textContent).toContain('Rendered');
  });

  it('escapes compile-error messages instead of injecting them', async () => {
    const el = document.createElement('seldia-editor') as any;
    el.value = INVALID_DSL;
    document.body.appendChild(el);
    await settle(el);
    el.shadowRoot!.querySelector('button')!.click();
    await settle(el);
    expect(el.shadowRoot!.querySelector('svg')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain('❌');
  });

  it('dispatches change events on input', async () => {
    const el = document.createElement('seldia-editor') as any;
    document.body.appendChild(el);
    await settle(el);
    const detail: any[] = [];
    el.addEventListener('change', (e: CustomEvent) => detail.push(e.detail.value));
    const ta = el.shadowRoot!.querySelector('textarea')!;
    ta.value = 'x';
    ta.dispatchEvent(new Event('input'));
    expect(detail).toEqual(['x']);
  });
});

describe('<seldia-live>', () => {
  it('recompiles the preview on textarea input', async () => {
    const el = document.createElement('seldia-live') as any;
    document.body.appendChild(el);
    await settle(el);
    const ta = el.shadowRoot!.querySelector('textarea')!;
    ta.value = VALID_DSL;
    ta.dispatchEvent(new Event('input'));
    await settle(el);
    expect(el.shadowRoot!.querySelector('.preview svg')).toBeTruthy();
  });

  it('clears the preview when the input is emptied', async () => {
    const el = document.createElement('seldia-live') as any;
    document.body.appendChild(el);
    await settle(el);
    const ta = el.shadowRoot!.querySelector('textarea')!;
    ta.value = VALID_DSL;
    ta.dispatchEvent(new Event('input'));
    await settle(el);
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    await settle(el);
    expect(el.shadowRoot!.querySelector('.preview svg')).toBeNull();
  });
});
