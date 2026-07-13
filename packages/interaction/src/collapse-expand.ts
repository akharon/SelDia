// =============================================================================
// SelDiA — Collapse / Expand Handler
// =============================================================================
// Enables collapsing and expanding group nodes (groups, C4 containers, etc.)
// in interactive SVG diagrams. Collapsing hides all child nodes and edges
// inside the group, replacing them with a compact summary indicator.
//
// Phase 8 — I2: Expand/collapse for groups and C4 containers

export interface CollapseExpandOptions {
  /** CSS class prefix for styling */
  classPrefix: string;
  /** Whether to animate collapse/expand transitions */
  animate: boolean;
  /** Animation duration in ms (only used if animate is true) */
  animationDuration: number;
  /** Show child count badge on collapsed groups */
  showChildCount: boolean;
  /** Whether newly added groups start collapsed */
  defaultCollapsed: boolean;
}

export interface CollapsibleGroup {
  /** The group/container element ID */
  id: string;
  /** Child node IDs */
  childNodeIds: string[];
  /** Child edge IDs */
  childEdgeIds: string[];
  /** Whether currently collapsed */
  collapsed: boolean;
  /** The bounding box of the group in diagram coordinates */
  bounds: { x: number; y: number; width: number; height: number };
}

export interface CollapseExpandCallbacks {
  onCollapse?: (groupId: string, childCount: number) => void;
  onExpand?: (groupId: string, childCount: number) => void;
  onToggle?: (groupId: string, nowCollapsed: boolean) => void;
}

const DEFAULT_OPTIONS: CollapseExpandOptions = {
  classPrefix: 'seldia',
  animate: true,
  animationDuration: 250,
  showChildCount: true,
  defaultCollapsed: false,
};

export class CollapseExpandHandler {
  private groups: Map<string, CollapsibleGroup> = new Map();
  private expandedBounds: Map<string, { x: number; y: number; width: number; height: number }> = new Map();
  private element: HTMLElement | SVGElement | null = null;
  private options: CollapseExpandOptions;
  private callbacks: CollapseExpandCallbacks;

  constructor(
    callbacks: CollapseExpandCallbacks = {},
    options: Partial<CollapseExpandOptions> = {}
  ) {
    this.callbacks = callbacks;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Attach to the container element. Adds click-to-toggle on group toggle buttons.
   */
  attach(element: HTMLElement | SVGElement): void {
    this.element = element;
    element.addEventListener('click', this.onToggleClick as EventListener);
  }

  /**
   * Detach event handlers.
   */
  detach(): void {
    if (!this.element) return;
    this.element.removeEventListener('click', this.onToggleClick as EventListener);
    this.element = null;
  }

  /**
   * Register a collapsible group.
   */
  registerGroup(group: CollapsibleGroup): void {
    this.groups.set(group.id, group);
    if (group.collapsed) {
      this.expandedBounds.set(group.id, { ...group.bounds });
    }

    // Add ARIA expand/collapse attributes to the SVG element
    if (this.element) {
      const svg = this.element instanceof SVGSVGElement
        ? this.element
        : this.element.querySelector('svg');
      if (svg) {
        const el = svg.querySelector(`[data-id="${group.id}"]`);
        if (el) {
          el.setAttribute('aria-expanded', String(!group.collapsed));
          el.setAttribute('role', 'group');
          el.setAttribute('aria-label', this.getGroupDescription(group));
        }
      }
    }
  }

  /**
   * Unregister a group (e.g., when deleted).
   */
  unregisterGroup(groupId: string): void {
    this.groups.delete(groupId);
    this.expandedBounds.delete(groupId);

    if (this.element) {
      const svg = this.element instanceof SVGSVGElement
        ? this.element
        : this.element.querySelector('svg');
      if (svg) {
        const el = svg.querySelector(`[data-id="${groupId}"]`);
        if (el) {
          el.removeAttribute('aria-expanded');
          el.removeAttribute('aria-label');
        }
      }
    }
  }

  /**
   * Collapse a group: hide children, show summary indicator.
   */
  collapse(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group || group.collapsed) return;

    // Save expanded bounds for restore on expand
    this.expandedBounds.set(groupId, { ...group.bounds });

    group.collapsed = true;
    this.applyCollapseState(group, true);
    this.callbacks.onCollapse?.(groupId, group.childNodeIds.length);
    this.callbacks.onToggle?.(groupId, true);
  }

  /**
   * Expand a group: show children, remove summary indicator.
   */
  expand(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group || !group.collapsed) return;

    group.collapsed = false;
    this.applyCollapseState(group, false);
    this.callbacks.onExpand?.(groupId, group.childNodeIds.length);
    this.callbacks.onToggle?.(groupId, false);
  }

  /**
   * Toggle a group's collapse state.
   */
  toggle(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    if (group.collapsed) {
      this.expand(groupId);
    } else {
      this.collapse(groupId);
    }
  }

  /**
   * Collapse all registered groups.
   */
  collapseAll(): void {
    for (const [id] of this.groups) {
      this.collapse(id);
    }
  }

  /**
   * Expand all registered groups.
   */
  expandAll(): void {
    for (const [id] of this.groups) {
      this.expand(id);
    }
  }

  /**
   * Check if a group is collapsed.
   */
  isCollapsed(groupId: string): boolean {
    return this.groups.get(groupId)?.collapsed ?? false;
  }

  /**
   * Get all registered groups.
   */
  getGroups(): CollapsibleGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * Clear all registered groups.
   */
  clear(): void {
    this.groups.clear();
    this.expandedBounds.clear();
  }

  /**
   * Get collapsed bounds (original expanded bounds saved at collapse time).
   */
  getExpandedBounds(groupId: string): { x: number; y: number; width: number; height: number } | undefined {
    return this.expandedBounds.get(groupId);
  }

  private applyCollapseState(group: CollapsibleGroup, collapsed: boolean): void {
    if (!this.element) return;

    const svg = this.element instanceof SVGSVGElement
      ? this.element
      : this.element.querySelector('svg');
    if (!svg) return;

    const groupEl = svg.querySelector(`[data-id="${group.id}"]`) as HTMLElement | null;
    if (!groupEl) return;

    // Toggle visibility of child elements
    const visibility = collapsed ? 'hidden' : 'visible';
    const display = collapsed ? 'none' : '';
    const opacity = collapsed ? '0' : '1';

    for (const childId of group.childNodeIds) {
      const child = svg.querySelector(`[data-id="${childId}"]`) as HTMLElement | null;
      if (child) {
        if (this.options.animate) {
          child.style.transition = `opacity ${this.options.animationDuration}ms ease`;
          child.style.opacity = opacity;
          // After animation, hide completely
          if (collapsed) {
            setTimeout(() => {
              child.style.display = 'none';
              child.setAttribute('aria-hidden', 'true');
            }, this.options.animationDuration);
          } else {
            child.style.display = '';
            child.setAttribute('aria-hidden', 'false');
          }
        } else {
          child.style.display = display;
          child.setAttribute('aria-hidden', String(collapsed));
        }
      }
    }

    for (const edgeId of group.childEdgeIds) {
      const edge = svg.querySelector(`[data-id="${edgeId}"]`) as HTMLElement | null;
      if (edge) {
        if (this.options.animate) {
          edge.style.transition = `opacity ${this.options.animationDuration}ms ease`;
          edge.style.opacity = opacity;
          if (collapsed) {
            setTimeout(() => {
              edge.style.display = 'none';
              edge.setAttribute('aria-hidden', 'true');
            }, this.options.animationDuration);
          } else {
            edge.style.display = '';
            edge.setAttribute('aria-hidden', 'false');
          }
        } else {
          edge.style.display = display;
          edge.setAttribute('aria-hidden', String(collapsed));
        }
      }
    }

    // Show/hide the collapse toggle indicator
    const toggleEl = groupEl.querySelector(`.${this.options.classPrefix}-collapse-toggle`);
    if (toggleEl) {
      toggleEl.setAttribute('data-collapsed', String(collapsed));
      toggleEl.textContent = collapsed ? '➕' : '➖';
    }

    // Show/hide the child count badge
    const badge = groupEl.querySelector(`.${this.options.classPrefix}-child-count`) as HTMLElement | null;
    if (badge) {
      if (collapsed && this.options.showChildCount) {
        badge.textContent = `${group.childNodeIds.length} items`;
        badge.setAttribute('aria-hidden', 'false');
        badge.style.display = '';
      } else {
        badge.setAttribute('aria-hidden', 'true');
        badge.style.display = 'none';
      }
    }

    // Update ARIA attributes
    groupEl.setAttribute('aria-expanded', String(!collapsed));

    // Add a visual indicator to the group border when collapsed
    if (collapsed) {
      groupEl.classList.add(`${this.options.classPrefix}-collapsed`);
    } else {
      groupEl.classList.remove(`${this.options.classPrefix}-collapsed`);
    }
  }

  private getGroupDescription(group: CollapsibleGroup): string {
    const state = group.collapsed ? 'collapsed' : 'expanded';
    return `Group ${group.id} with ${group.childNodeIds.length} items, ${state}. Click toggle button to ${group.collapsed ? 'expand' : 'collapse'}.`;
  }

  private onToggleClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const toggleBtn = target.closest('[data-collapse-toggle]');
    if (!toggleBtn) return;

    const groupId = toggleBtn.getAttribute('data-group-id');
    if (groupId && this.groups.has(groupId)) {
      e.stopPropagation();
      this.toggle(groupId);
    }
  };
}
