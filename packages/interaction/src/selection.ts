// =============================================================================
// SelDiA — Selection Manager
// =============================================================================
// Handles click selection of nodes/edges in interactive SVG diagrams.

export interface SelectableItem {
  id: string;
  type: 'node' | 'edge' | 'group';
  bounds: { x: number; y: number; width: number; height: number };
}

export interface SelectionCallbacks {
  onSelectionChange: (selectedIds: string[]) => void;
  onDoubleClick: (item: SelectableItem) => void;
  onContextMenu: (item: SelectableItem, x: number, y: number) => void;
}

export class SelectionManager {
  private selectedIds: Set<string> = new Set();
  private items: Map<string, SelectableItem> = new Map();
  private element: HTMLElement | SVGElement | null = null;
  private callbacks: SelectionCallbacks;

  constructor(callbacks: SelectionCallbacks) {
    this.callbacks = callbacks;
  }

  attach(element: HTMLElement | SVGElement): void {
    this.element = element;
    element.addEventListener('click', this.onClick as EventListener);
    element.addEventListener('dblclick', this.onDoubleClick as EventListener);
    element.addEventListener('contextmenu', this.onContextMenu as EventListener);
  }

  detach(): void {
    if (!this.element) return;
    this.element.removeEventListener('click', this.onClick as EventListener);
    this.element.removeEventListener('dblclick', this.onDoubleClick as EventListener);
    this.element.removeEventListener('contextmenu', this.onContextMenu as EventListener);
    this.element = null;
  }

  setItems(items: SelectableItem[]): void {
    this.items.clear();
    for (const item of items) {
      this.items.set(item.id, item);
    }
  }

  select(id: string, additive: boolean = false): void {
    if (!additive) this.selectedIds.clear();
    if (this.items.has(id)) {
      this.selectedIds.add(id);
    }
    this.updateVisualState();
    this.callbacks.onSelectionChange(this.getSelectedIds());
  }

  deselect(id?: string): void {
    if (id) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.clear();
    }
    this.updateVisualState();
    this.callbacks.onSelectionChange(this.getSelectedIds());
  }

  toggle(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.updateVisualState();
    this.callbacks.onSelectionChange(this.getSelectedIds());
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  getSelectedIds(): string[] {
    return Array.from(this.selectedIds);
  }

  getSelectedItems(): SelectableItem[] {
    return this.getSelectedIds()
      .map(id => this.items.get(id))
      .filter((item): item is SelectableItem => item !== undefined);
  }

  selectAll(): void {
    for (const id of this.items.keys()) {
      this.selectedIds.add(id);
    }
    this.updateVisualState();
    this.callbacks.onSelectionChange(this.getSelectedIds());
  }

  clear(): void {
    this.selectedIds.clear();
    this.updateVisualState();
    this.callbacks.onSelectionChange(this.getSelectedIds());
  }

  findItemAt(x: number, y: number): SelectableItem | undefined {
    // Items added later are rendered on top, so search in reverse
    for (const item of Array.from(this.items.values()).reverse()) {
      const b = item.bounds;
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        return item;
      }
    }
    return undefined;
  }

  private updateVisualState(): void {
    if (!this.element) return;
    // Add/remove 'selected' class on SVG elements
    const svg = this.element instanceof SVGSVGElement ? this.element : this.element.querySelector('svg');
    if (!svg) return;

    for (const [id] of this.items) {
      const el = svg.querySelector(`[data-id="${id}"]`);
      if (el) {
        if (this.selectedIds.has(id)) {
          el.classList.add('seldia-selected');
          el.setAttribute('data-selected', 'true');
        } else {
          el.classList.remove('seldia-selected');
          el.setAttribute('data-selected', 'false');
        }
      }
    }
  }

  private getTargetId(e: MouseEvent): string | undefined {
    const target = e.target as HTMLElement;
    const el = target.closest('[data-id]');
    return el?.getAttribute('data-id') || undefined;
  }

  private onClick = (e: MouseEvent): void => {
    const id = this.getTargetId(e);
    if (id && this.items.has(id)) {
      this.select(id, e.ctrlKey || e.metaKey);
    } else {
      this.clear();
    }
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const id = this.getTargetId(e);
    if (id) {
      const item = this.items.get(id);
      if (item) {
        this.callbacks.onDoubleClick(item);
      }
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const id = this.getTargetId(e);
    if (id) {
      const item = this.items.get(id);
      if (item) {
        if (!this.isSelected(id)) {
          this.select(id);
        }
        this.callbacks.onContextMenu(item, e.clientX, e.clientY);
      }
    }
  };
}
