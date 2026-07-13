// =============================================================================
// SelDiA — Drag & Drop Handler
// =============================================================================
// Enables node dragging within interactive SVG diagrams.

export interface DragCallbacks {
  onDragStart: (nodeId: string, x: number, y: number) => void;
  onDragMove: (nodeId: string, x: number, y: number, dx: number, dy: number) => void;
  onDragEnd: (nodeId: string, x: number, y: number) => void;
}

export class DragDropHandler {
  private element: HTMLElement | SVGElement | null = null;
  private callbacks: DragCallbacks;
  private isDragging = false;
  private dragNodeId: string | null = null;
  private startX = 0;
  private startY = 0;
  private offsetX = 0;
  private offsetY = 0;

  constructor(callbacks: DragCallbacks) {
    this.callbacks = callbacks;
  }

  attach(element: HTMLElement | SVGElement): void {
    this.element = element;
    element.addEventListener('mousedown', this.onMouseDown as EventListener);
    document.addEventListener('mousemove', this.onMouseMove as EventListener);
    document.addEventListener('mouseup', this.onMouseUp as EventListener);

    // Touch support
    element.addEventListener('touchstart', this.onTouchStart as EventListener, { passive: false });
    document.addEventListener('touchmove', this.onTouchMove as EventListener, { passive: false });
    document.addEventListener('touchend', this.onTouchUp as EventListener);
  }

  detach(): void {
    if (!this.element) return;
    this.element.removeEventListener('mousedown', this.onMouseDown as EventListener);
    document.removeEventListener('mousemove', this.onMouseMove as EventListener);
    document.removeEventListener('mouseup', this.onMouseUp as EventListener);
    document.removeEventListener('touchstart', this.onTouchStart as EventListener);
    document.removeEventListener('touchmove', this.onTouchMove as EventListener);
    document.removeEventListener('touchend', this.onTouchUp as EventListener);
    this.element = null;
  }

  getIsDragging(): boolean {
    return this.isDragging;
  }

  getDragNodeId(): string | null {
    return this.dragNodeId;
  }

  private getNodeIdFromEvent(e: MouseEvent | Touch): string | undefined {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return undefined;
    const nodeEl = (el as HTMLElement).closest('[data-id]');
    return nodeEl?.getAttribute('data-id') || undefined;
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || e.shiftKey) return;
    const id = this.getNodeIdFromEvent(e);
    if (id) {
      this.dragNodeId = id;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.offsetX = 0;
      this.offsetY = 0;
      this.isDragging = false; // Will become true on first move
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.dragNodeId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;

    if (!this.isDragging) {
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.isDragging = true;
        this.callbacks.onDragStart(this.dragNodeId, e.clientX, e.clientY);
      }
      return;
    }

    this.offsetX += dx - this.offsetX;
    this.offsetY += dy - this.offsetY;
    this.callbacks.onDragMove(this.dragNodeId, e.clientX, e.clientY, dx, dy);
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (this.dragNodeId && this.isDragging) {
      this.callbacks.onDragEnd(this.dragNodeId, e.clientX, e.clientY);
    }
    this.isDragging = false;
    this.dragNodeId = null;
  };

  // Touch support
  private onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const id = this.getNodeIdFromEvent(touch);
    if (id) {
      this.dragNodeId = id;
      this.startX = touch.clientX;
      this.startY = touch.clientY;
      this.isDragging = false;
      e.preventDefault();
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (!this.dragNodeId || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - this.startX;
    const dy = touch.clientY - this.startY;

    if (!this.isDragging) {
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.isDragging = true;
        this.callbacks.onDragStart(this.dragNodeId, touch.clientX, touch.clientY);
      }
      return;
    }

    this.callbacks.onDragMove(this.dragNodeId, touch.clientX, touch.clientY, dx, dy);
    e.preventDefault();
  };

  private onTouchUp = (e: TouchEvent): void => {
    if (this.dragNodeId && this.isDragging) {
      this.callbacks.onDragEnd(this.dragNodeId, this.startX + this.offsetX, this.startY + this.offsetY);
    }
    this.isDragging = false;
    this.dragNodeId = null;
  };
}
