// =============================================================================
// SelDiA — Floorplan Furniture/Fixture Catalog
// =============================================================================
// Standard architectural dimensions (metres) for common fixtures and furniture,
// sourced from public building-code and drafting-standard ranges (ISO/ANSI
// residential drafting conventions) rather than any single proprietary dataset.
// `size` here is a DEFAULT — `furniture "sofa" in Living at 1,1 size 2.4x0.9`
// overrides it inline, so the catalog only needs to cover the common case.
//
// Kept as a flat table, not a class hierarchy: every entry is drawn by the same
// generic symbol function keyed on `symbol`, so adding a new catalog item never
// requires new renderer code — only a new row (or, if truly novel, a new case
// in floorplan-render.ts's symbol switch).
// =============================================================================

export interface FurnitureSpec {
  key: string;
  label: string;
  /** Default footprint in metres, author's local diagram units. */
  width: number;
  depth: number;
  /** Which generic symbol drawer renders this item. */
  symbol: 'rect-label' | 'bed' | 'sink' | 'stove' | 'fridge' | 'toilet' | 'bathtub'
    | 'shower' | 'sofa' | 'chair' | 'table' | 'tv' | 'shelf' | 'stairs-straight'
    | 'stairs-turn' | 'stairs-spiral' | 'carpet' | 'counter' | 'radiator' | 'floor-heating';
}

const F = (key: string, label: string, width: number, depth: number, symbol: FurnitureSpec['symbol']): FurnitureSpec =>
  ({ key, label, width, depth, symbol });

/** Closed catalog — same rationale as workitem/schema.ts's closed vocabulary:
 *  an unknown key falls back to a plain labelled rectangle sized 1x1 (see
 *  `catalogItem`) rather than erroring, so a half-known plan still renders. */
export const FURNITURE_CATALOG: Record<string, FurnitureSpec> = {
  // Kitchen
  'sink':          F('sink', 'Sink', 0.6, 0.55, 'sink'),
  'stove':         F('stove', 'Stove', 0.6, 0.6, 'stove'),
  'fridge':        F('fridge', 'Fridge', 0.7, 0.7, 'fridge'),
  'counter':       F('counter', 'Counter', 1.2, 0.6, 'counter'),
  'dishwasher':    F('dishwasher', 'D/W', 0.6, 0.6, 'rect-label'),

  // Bathroom
  'toilet':        F('toilet', 'WC', 0.4, 0.6, 'toilet'),
  'bathtub':       F('bathtub', 'Bath', 1.7, 0.75, 'bathtub'),
  'shower-cabin':  F('shower-cabin', 'Shower', 0.9, 0.9, 'shower'),
  'sink-bath':     F('sink-bath', 'Sink', 0.5, 0.45, 'sink'),

  // Bedroom
  'bed-single':    F('bed-single', 'Single', 0.9, 1.9, 'bed'),
  'bed-double':    F('bed-double', 'Double', 1.4, 1.9, 'bed'),
  'bed-queen':     F('bed-queen', 'Queen', 1.5, 2.0, 'bed'),
  'bed-king':      F('bed-king', 'King', 1.8, 2.0, 'bed'),

  // Living / dining
  'sofa':          F('sofa', 'Sofa', 2.0, 0.9, 'sofa'),
  'sofa-2seat':    F('sofa-2seat', 'Sofa', 1.5, 0.9, 'sofa'),
  'armchair':      F('armchair', 'Chair', 0.8, 0.8, 'chair'),
  'chair':         F('chair', 'Chair', 0.45, 0.5, 'chair'),
  'dining-table':  F('dining-table', 'Table', 1.6, 0.9, 'table'),
  'coffee-table':  F('coffee-table', 'Table', 1.1, 0.55, 'table'),
  'tv':            F('tv', 'TV', 1.2, 0.1, 'tv'),
  'tv-table':      F('tv-table', 'TV Table', 1.2, 0.4, 'table'),
  'bookshelf':     F('bookshelf', 'Shelf', 0.8, 0.3, 'shelf'),
  'wardrobe':      F('wardrobe', 'Wardrobe', 1.2, 0.6, 'rect-label'),

  // Circulation
  'stairs-straight': F('stairs-straight', 'Stairs', 1.0, 3.5, 'stairs-straight'),
  'stairs-turn':      F('stairs-turn', 'Stairs', 2.2, 2.2, 'stairs-turn'),
  'stairs-spiral':    F('stairs-spiral', 'Stairs', 1.6, 1.6, 'stairs-spiral'),

  // Misc
  'carpet-small':  F('carpet-small', 'Rug', 1.6, 2.3, 'carpet'),
  'carpet-large':  F('carpet-large', 'Rug', 2.4, 3.4, 'carpet'),

  // Heating — radiator is a thin wall-mounted panel (default width along a
  // wall, shallow depth away from it); floor-heating is an area fill sized
  // like a rug, since it covers a zone of the floor rather than sitting on it.
  'radiator':      F('radiator', 'Rad.', 0.8, 0.12, 'radiator'),
  'floor-heating': F('floor-heating', 'UFH', 2.0, 2.0, 'floor-heating'),
};

/** Standard door/window widths (metres), used when the DSL omits `width`. */
export const DEFAULT_DOOR_WIDTH = 0.9;
export const DEFAULT_WINDOW_WIDTH = 1.2;

/** Look up a catalog entry, falling back to a generic 1x1 labelled box for an
 *  unknown key — see the module doc for why this is a fallback, not an error. */
export function catalogItem(key: string): FurnitureSpec {
  const norm = key.toLowerCase().trim();
  return FURNITURE_CATALOG[norm] || F(norm, key, 1, 1, 'rect-label');
}
