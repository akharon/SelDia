// =============================================================================
// SelDiA — ARIA Accessibility Annotations
// =============================================================================
// Adds ARIA attributes, roles, labels, and live regions to SVG diagram
// elements for screen reader compatibility. Also manages keyboard focus
// indicators and announces diagram state changes.
//
// Phase 8 — I5: ARIA accessibility annotations

export interface AriaOptions {
  /** Role for the root SVG element */
  svgRole: string;
  /** Role for diagram nodes */
  nodeRole: string;
  /** Role for diagram edges */
  edgeRole: string;
  /** Role for diagram groups */
  groupRole: string;
  /** Whether to add live region for announcements */
  enableLiveRegion: boolean;
  /** ARIA live region politeness setting */
  liveRegionPoliteness: 'off' | 'polite' | 'assertive';
  /** Whether to add keyboard tabindex to interactive elements */
  enableTabIndex: boolean;
  /** Whether to add descriptions for visual properties */
  includeVisualDescriptions: boolean;
}

export interface AriaAnnotation {
  /** Element ID */
  id: string;
  /** Element type */
  type: 'node' | 'edge' | 'group';
  /** Human-readable label */
  label: string;
  /** Optional description */
  description?: string;
  /** Visual properties for description */
  visualProps?: {
    shape?: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    color?: string;
  };
  /** Child count (for groups) */
  childCount?: number;
  /** Whether the element is collapsed (for groups) */
  collapsed?: boolean;
}

export interface AriaAnnouncement {
  /** Announcement text */
  text: string;
  /** Priority level */
  priority: 'polite' | 'assertive';
}

const DEFAULT_OPTIONS: AriaOptions = {
  svgRole: 'img',
  nodeRole: 'graphics-symbol',
  edgeRole: 'graphics-symbol',
  groupRole: 'group',
  enableLiveRegion: true,
  liveRegionPoliteness: 'polite',
  enableTabIndex: true,
  includeVisualDescriptions: true,
};

export class AriaManager {
  private element: HTMLElement | SVGElement | null = null;
  private liveRegion: HTMLDivElement | null = null;
  private options: AriaOptions;
  private announcementQueue: AriaAnnouncement[] = [];
  private isAnnouncing = false;

  constructor(options: Partial<AriaOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Attach to the container element. Sets up ARIA roles and live region.
   */
  attach(element: HTMLElement | SVGElement): void {
    this.element = element;

    // Set role on the container
    element.setAttribute('role', this.options.svgRole);
    element.setAttribute('aria-label', 'SelDiA Diagram');
    element.setAttribute('tabindex', '0');

    // Make the SVG focusable
    const svg = element instanceof SVGSVGElement
      ? element
      : element.querySelector('svg');
    if (svg) {
      svg.setAttribute('role', this.options.svgRole);
      svg.setAttribute('aria-label', 'SelDiA Diagram — Interactive diagram. Use arrow keys to navigate, Tab to focus elements.');
      if (this.options.enableTabIndex) {
        svg.setAttribute('tabindex', '0');
      }
    }

    // Create live region for announcements
    if (this.options.enableLiveRegion) {
      this.createLiveRegion();
    }
  }

  /**
   * Detach and clean up.
   */
  detach(): void {
    if (this.element) {
      this.element.removeAttribute('role');
      this.element.removeAttribute('aria-label');
      this.element.removeAttribute('tabindex');

      const svg = this.element instanceof SVGSVGElement
        ? this.element
        : this.element.querySelector('svg');
      if (svg) {
        svg.removeAttribute('role');
        svg.removeAttribute('aria-label');
        svg.removeAttribute('tabindex');
      }
    }

    if (this.liveRegion) {
      this.liveRegion.remove();
      this.liveRegion = null;
    }

    this.element = null;
    this.announcementQueue = [];
  }

  /**
   * Annotate a diagram element with ARIA attributes.
   */
  annotateElement(annotation: AriaAnnotation): void {
    if (!this.element) return;

    const svg = this.element instanceof SVGSVGElement
      ? this.element
      : this.element.querySelector('svg');
    if (!svg) return;

    const el = svg.querySelector(`[data-id="${annotation.id}"]`);
    if (!el) return;

    // Role
    const roleMap = {
      node: this.options.nodeRole,
      edge: this.options.edgeRole,
      group: this.options.groupRole,
    };
    el.setAttribute('role', roleMap[annotation.type]);

    // Label
    const label = annotation.label || annotation.id;
    el.setAttribute('aria-label', label);

    // Description
    const descParts: string[] = [];
    if (annotation.description) {
      descParts.push(annotation.description);
    }

    if (this.options.includeVisualDescriptions && annotation.visualProps) {
      const vp = annotation.visualProps;
      if (vp.shape) descParts.push(`Shape: ${vp.shape}`);
      if (vp.position) descParts.push(`Position: x ${Math.round(vp.position.x)}, y ${Math.round(vp.position.y)}`);
      if (vp.size) descParts.push(`Size: ${Math.round(vp.size.width)} by ${Math.round(vp.size.height)} pixels`);
      if (vp.color) descParts.push(`Color: ${vp.color}`);
    }

    if (annotation.type === 'group' && annotation.childCount !== undefined) {
      const state = annotation.collapsed ? 'collapsed' : 'expanded';
      descParts.push(`${annotation.childCount} child elements, ${state}`);
    }

    if (descParts.length > 0) {
      el.setAttribute('aria-description', descParts.join('. '));
    }

    // Tabindex for interactive elements
    if (this.options.enableTabIndex) {
      el.setAttribute('tabindex', '0');
    }

    // Group expand/collapse
    if (annotation.type === 'group' && annotation.collapsed !== undefined) {
      el.setAttribute('aria-expanded', String(!annotation.collapsed));
    }
  }

  /**
   * Batch annotate multiple elements at once.
   */
  annotateElements(annotations: AriaAnnotation[]): void {
    for (const ann of annotations) {
      this.annotateElement(ann);
    }
  }

  /**
   * Queue an announcement to be read by screen readers.
   */
  announce(text: string, priority: 'polite' | 'assertive' = 'polite'): void {
    this.announcementQueue.push({ text, priority });
    this.processAnnouncementQueue();
  }

  /**
   * Set the diagram-level label.
   */
  setDiagramLabel(label: string): void {
    if (this.element) {
      this.element.setAttribute('aria-label', label);
    }
    const svg = this.element?.querySelector('svg');
    if (svg) {
      svg.setAttribute('aria-label', label);
    }
  }

  /**
   * Annotate a connection/edge with its source and target.
   */
  annotateEdge(edgeId: string, sourceLabel: string, targetLabel: string, edgeLabel?: string): void {
    if (!this.element) return;

    const svg = this.element instanceof SVGSVGElement
      ? this.element
      : this.element.querySelector('svg');
    if (!svg) return;

    const el = svg.querySelector(`[data-id="${edgeId}"]`);
    if (!el) return;

    const label = edgeLabel
      ? `Edge from ${sourceLabel} to ${targetLabel}, labeled ${edgeLabel}`
      : `Edge from ${sourceLabel} to ${targetLabel}`;

    el.setAttribute('role', this.options.edgeRole);
    el.setAttribute('aria-label', label);
    el.setAttribute('tabindex', this.options.enableTabIndex ? '0' : '-1');
  }

  /**
   * Update keyboard focus indicator for a specific element.
   */
  setFocus(elementId: string): void {
    if (!this.element) return;

    const svg = this.element instanceof SVGSVGElement
      ? this.element
      : this.element.querySelector('svg');
    if (!svg) return;

    // Remove previous focus
    const prevFocus = svg.querySelector('[data-focused="true"]');
    if (prevFocus) {
      prevFocus.setAttribute('data-focused', 'false');
      prevFocus.classList.remove('seldia-focused');
    }

    // Set new focus
    const el = svg.querySelector(`[data-id="${elementId}"]`);
    if (el) {
      el.setAttribute('data-focused', 'true');
      el.classList.add('seldia-focused');
      el.setAttribute('tabindex', '0');
      (el as HTMLElement).focus();
    }
  }

  /**
   * Clear keyboard focus.
   */
  clearFocus(): void {
    if (!this.element) return;
    const svg = this.element instanceof SVGSVGElement
      ? this.element
      : this.element.querySelector('svg');
    if (!svg) return;

    const focused = svg.querySelector('[data-focused="true"]');
    if (focused) {
      focused.setAttribute('data-focused', 'false');
      focused.classList.remove('seldia-focused');
    }
  }

  /**
   * Register keyboard event handlers for accessible navigation.
   */
  registerKeyboardNavigation(
    onNavigate: (direction: 'up' | 'down' | 'left' | 'right', currentId: string) => void,
    onActivate: (elementId: string) => void
  ): void {
    if (!this.element) return;

    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      const target = ke.target as HTMLElement;
      const id = target.getAttribute('data-id');
      if (!id) return;

      switch (ke.key) {
        case 'ArrowUp':
          ke.preventDefault();
          onNavigate('up', id);
          break;
        case 'ArrowDown':
          ke.preventDefault();
          onNavigate('down', id);
          break;
        case 'ArrowLeft':
          ke.preventDefault();
          onNavigate('left', id);
          break;
        case 'ArrowRight':
          ke.preventDefault();
          onNavigate('right', id);
          break;
        case 'Enter':
        case ' ':
          ke.preventDefault();
          onActivate(id);
          break;
      }
    };
    this.element.addEventListener('keydown', handler);
  }

  private createLiveRegion(): void {
    this.liveRegion = document.createElement('div');
    this.liveRegion.setAttribute('role', 'status');
    this.liveRegion.setAttribute('aria-live', this.options.liveRegionPoliteness);
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.liveRegion.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(this.liveRegion);
  }

  private processAnnouncementQueue(): void {
    if (this.isAnnouncing || this.announcementQueue.length === 0) return;
    this.isAnnouncing = true;

    const process = () => {
      const next = this.announcementQueue.shift();
      if (!next) {
        this.isAnnouncing = false;
        return;
      }

      if (this.liveRegion) {
        // Set the politeness for this announcement
        this.liveRegion.setAttribute('aria-live', next.priority);
        this.liveRegion.textContent = '';

        // Use requestAnimationFrame to ensure the empty text is processed
        requestAnimationFrame(() => {
          if (this.liveRegion) {
            this.liveRegion.textContent = next.text;
          }
          // Process next announcement after a delay
          setTimeout(process, 500);
        });
      } else {
        process();
      }
    };

    process();
  }
}
