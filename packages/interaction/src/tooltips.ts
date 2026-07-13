// =============================================================================
// SelDiA — Tooltip System
// =============================================================================
// Provides rich tooltips for diagram elements (nodes, edges, groups).
// Supports HTML content, delayed show/hide, and positioning relative to
// diagram coordinates (accounting for zoom/pan transforms).
//
// Phase 8 — I3: Tooltip system

export interface TooltipOptions {
  /** Delay before showing the tooltip (ms) */
  showDelay: number;
  /** Delay before hiding the tooltip (ms) */
  hideDelay: number;
  /** Maximum tooltip width (px) */
  maxWidth: number;
  /** Whether tooltips follow the mouse */
  followMouse: boolean;
  /** Offset from the mouse/element (px) */
  offsetX: number;
  /** Offset from the mouse/element (px) */
  offsetY: number;
  /** CSS class for the tooltip container */
  className: string;
  /** Z-index for the tooltip */
  zIndex: number;
  /** Whether to show tooltips on focus (for keyboard/ARIA users) */
  showOnFocus: boolean;
}

export interface TooltipContent {
  /** Primary title text (bold, single line) */
  title?: string;
  /** Description body text */
  description?: string;
  /** Key-value metadata rows */
  metadata?: Array<{ key: string; value: string }>;
  /** Optional HTML content (overrides title/description/metadata if set) */
  html?: string;
}

const DEFAULT_OPTIONS: TooltipOptions = {
  showDelay: 500,
  hideDelay: 200,
  maxWidth: 300,
  followMouse: true,
  offsetX: 12,
  offsetY: 12,
  className: 'seldia-tooltip',
  zIndex: 10000,
  showOnFocus: true,
};

export class TooltipManager {
  private tooltipEl: HTMLDivElement | null = null;
  private element: HTMLElement | SVGElement | null = null;
  private options: TooltipOptions;
  private showTimeout: ReturnType<typeof setTimeout> | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentTarget: string | null = null;
  private boundListeners: Array<{ el: EventTarget; type: string; handler: EventListener }> = [];

  constructor(options: Partial<TooltipOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Attach tooltip listeners to the container. Tooltips are triggered
   * by hovering over elements with a `data-tooltip` attribute.
   */
  attach(element: HTMLElement | SVGElement): void {
    this.element = element;
    this.createTooltipElement();

    const listeners: Array<[EventTarget, string, EventListener]> = [
      [element, 'mouseover', this.onMouseOver as EventListener],
      [element, 'mouseout', this.onMouseOut as EventListener],
      [element, 'mousemove', this.onMouseMove as EventListener],
    ];

    if (this.options.showOnFocus) {
      // Use event capture to catch focus on nested SVG elements
      listeners.push([element, 'focusin', this.onFocusIn as EventListener]);
      listeners.push([element, 'focusout', this.onFocusOut as EventListener]);
    }

    for (const [el, type, handler] of listeners) {
      el.addEventListener(type, handler);
      this.boundListeners.push({ el, type, handler });
    }
  }

  /**
   * Detach tooltip listeners and remove the tooltip DOM element.
   */
  detach(): void {
    for (const { el, type, handler } of this.boundListeners) {
      el.removeEventListener(type, handler);
    }
    this.boundListeners = [];
    this.clearTimeouts();
    this.removeTooltip();
    this.element = null;
  }

  /**
   * Programmatically show a tooltip for a specific element or at a position.
   */
  showForElement(target: HTMLElement | SVGElement, content?: TooltipContent): void {
    this.clearTimeouts();
    this.currentTarget = target.getAttribute('data-id') || 'custom';

    const tooltipText = content
      ? this.formatContent(content)
      : target.getAttribute('data-tooltip') || '';

    if (!tooltipText) return;

    this.createTooltipElement();
    if (this.tooltipEl) {
      this.tooltipEl.innerHTML = tooltipText;
      this.positionNearElement(target as HTMLElement);
      this.tooltipEl.classList.add(`${this.options.className}-visible`);
    }
  }

  /**
   * Programmatically hide the tooltip.
   */
  hide(): void {
    this.clearTimeouts();
    this.currentTarget = null;
    this.removeTooltip();
  }

  /**
   * Update tooltip options.
   */
  setOptions(options: Partial<TooltipOptions>): void {
    Object.assign(this.options, options);
    if (this.tooltipEl) {
      this.tooltipEl.style.maxWidth = `${this.options.maxWidth}px`;
      this.tooltipEl.style.zIndex = String(this.options.zIndex);
    }
  }

  /**
   * Set custom tooltip content for a specific element at any time.
   * The element must have a `data-id` attribute.
   */
  setTooltipContent(elementId: string, content: TooltipContent): void {
    if (!this.element) return;
    const svg = this.element instanceof SVGSVGElement
      ? this.element
      : this.element.querySelector('svg');
    if (!svg) return;

    const el = svg.querySelector(`[data-id="${elementId}"]`);
    if (el) {
      el.setAttribute('data-tooltip', this.formatContent(content));
    }
  }

  private createTooltipElement(): void {
    if (this.tooltipEl) return;

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = this.options.className;
    this.tooltipEl.style.cssText = `
      position: fixed;
      max-width: ${this.options.maxWidth}px;
      z-index: ${this.options.zIndex};
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      background: rgba(30, 30, 30, 0.95);
      color: #eee;
      font-size: 13px;
      line-height: 1.4;
      padding: 8px 12px;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      white-space: nowrap;
    `;
    document.body.appendChild(this.tooltipEl);
  }

  private removeTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.classList.remove(`${this.options.className}-visible`);
      this.tooltipEl.style.opacity = '0';
      // Remove after transition
      setTimeout(() => {
        if (this.tooltipEl && this.currentTarget === null) {
          this.tooltipEl.remove();
          this.tooltipEl = null;
        }
      }, 150);
    }
  }

  private formatContent(content: TooltipContent): string {
    if (content.html) return content.html;

    const parts: string[] = [];

    if (content.title) {
      parts.push(`<strong style="font-size:14px;display:block;margin-bottom:4px">${this.escapeHtml(content.title)}</strong>`);
    }

    if (content.description) {
      parts.push(`<span style="display:block;margin-bottom:4px">${this.escapeHtml(content.description)}</span>`);
    }

    if (content.metadata && content.metadata.length > 0) {
      const rows = content.metadata
        .map(m => `<tr><td style="color:#999;padding-right:8px;white-space:nowrap">${this.escapeHtml(m.key)}</td><td style="color:#fff">${this.escapeHtml(m.value)}</td></tr>`)
        .join('');
      parts.push(`<table style="border-collapse:collapse;margin-top:4px">${rows}</table>`);
    }

    return parts.join('');
  }

  private getTooltipContent(element: HTMLElement): string | null {
    // Check for data-tooltip attribute first
    const attr = element.getAttribute('data-tooltip');
    if (attr) return attr;

    // Build from data-* attributes
    const id = element.getAttribute('data-id');
    const type = element.getAttribute('data-type');
    const label = element.getAttribute('data-label');
    const shape = element.getAttribute('data-shape');
    const desc = element.getAttribute('data-description');

    if (!id && !label) return null;

    const content: TooltipContent = {
      title: label || id || undefined,
      description: desc || undefined,
      metadata: [],
    };

    if (type) content.metadata!.push({ key: 'Type', value: type });
    if (shape) content.metadata!.push({ key: 'Shape', value: shape });
    if (id) content.metadata!.push({ key: 'ID', value: id });

    return content.metadata!.length > 0 || content.title || content.description
      ? this.formatContent(content)
      : null;
  }

  private showTooltip(target: HTMLElement): void {
    this.clearTimeouts();

    this.showTimeout = setTimeout(() => {
      if (!this.tooltipEl) this.createTooltipElement();

      const content = this.getTooltipContent(target);
      if (!content || !this.tooltipEl) return;

      this.currentTarget = target.getAttribute('data-id') || 'unknown';
      this.tooltipEl.innerHTML = content;
      this.positionNearTarget(target);
      this.tooltipEl.style.opacity = '1';
      this.tooltipEl.classList.add(`${this.options.className}-visible`);
    }, this.options.showDelay);
  }

  private scheduleHide(): void {
    this.clearTimeouts();

    this.hideTimeout = setTimeout(() => {
      if (this.tooltipEl) {
        this.tooltipEl.style.opacity = '0';
        this.tooltipEl.classList.remove(`${this.options.className}-visible`);
      }
      this.currentTarget = null;
    }, this.options.hideDelay);
  }

  private positionNearElement(target: HTMLElement): void {
    if (!this.tooltipEl) return;
    const rect = target.getBoundingClientRect();
    let left = rect.right + this.options.offsetX;
    let top = rect.top + this.options.offsetY;

    // Keep tooltip within viewport
    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width || this.options.maxWidth;
    const tooltipHeight = tooltipRect.height || 40;

    if (left + tooltipWidth > window.innerWidth - 10) {
      left = rect.left - tooltipWidth - this.options.offsetX;
    }
    if (top + tooltipHeight > window.innerHeight - 10) {
      top = window.innerHeight - tooltipHeight - 10;
    }
    if (top < 10) top = 10;

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  private positionNearTarget(target: HTMLElement): void {
    if (!this.options.followMouse || !this.tooltipEl) {
      this.positionNearElement(target);
      return;
    }
    // If followMouse is true, position is set by mousemove
  }

  private positionAtMouse(e: MouseEvent): void {
    if (!this.tooltipEl) return;

    let left = e.clientX + this.options.offsetX;
    let top = e.clientY + this.options.offsetY;

    // Keep tooltip within viewport
    const tooltipWidth = this.tooltipEl.offsetWidth || this.options.maxWidth;
    const tooltipHeight = this.tooltipEl.offsetHeight || 40;

    if (left + tooltipWidth > window.innerWidth - 10) {
      left = e.clientX - tooltipWidth - this.options.offsetX;
    }
    if (top + tooltipHeight > window.innerHeight - 10) {
      top = window.innerHeight - tooltipHeight - 10;
    }
    if (top < 10) top = 10;

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  private clearTimeouts(): void {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private getTooltipTarget(e: MouseEvent): HTMLElement | null {
    const target = e.target as HTMLElement;
    // Walk up to find an element with tooltip data
    let el: HTMLElement | null = target;
    while (el && el !== this.element) {
      if (
        el.hasAttribute('data-tooltip') ||
        el.hasAttribute('data-id') ||
        el.hasAttribute('data-label')
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // ---- Event Handlers ----

  private onMouseOver = (e: MouseEvent): void => {
    const target = this.getTooltipTarget(e);
    if (target) {
      this.scheduleHide(); // Cancel any pending hide
      this.showTooltip(target);
    }
  };

  private onMouseOut = (e: MouseEvent): void => {
    const target = this.getTooltipTarget(e);
    const related = e.relatedTarget as HTMLElement | null;

    // Don't hide if moving to a child of the same tooltip target
    if (target && related && target.contains(related)) return;

    this.scheduleHide();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.currentTarget && this.options.followMouse && this.tooltipEl) {
      this.positionAtMouse(e);
    }
  };

  private onFocusIn = (e: FocusEvent): void => {
    const target = e.target as HTMLElement;
    const tooltipTarget = target.closest('[data-id], [data-tooltip]') as HTMLElement | null;
    if (tooltipTarget) {
      this.clearTimeouts();

      this.showTimeout = setTimeout(() => {
        if (!this.tooltipEl) this.createTooltipElement();

        const content = this.getTooltipContent(tooltipTarget);
        if (!content || !this.tooltipEl) return;

        this.currentTarget = tooltipTarget.getAttribute('data-id') || 'focused';
        this.tooltipEl.innerHTML = content;
        this.positionNearElement(tooltipTarget);
        this.tooltipEl.style.opacity = '1';
        this.tooltipEl.classList.add(`${this.options.className}-visible`);
      }, this.options.showDelay);
    }
  };

  private onFocusOut = (e: FocusEvent): void => {
    const target = e.target as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;

    // Don't hide if focus moves within the same target
    if (target && related && target.contains(related)) return;

    this.scheduleHide();
  };
}
