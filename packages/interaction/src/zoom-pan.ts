// =============================================================================
// SelDiA — Zoom & Pan Handler
// =============================================================================
// Provides zoom and pan controls for SVG/HTML diagram containers.

export interface ViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface ZoomPanCallbacks {
  onViewportChange: (state: ViewportState) => void;
}

export class ZoomPanHandler {
  private state: ViewportState = { scale: 1, offsetX: 0, offsetY: 0 };
  private isPanning = false;
  private startX = 0;
  private startY = 0;
  private startOffsetX = 0;
  private startOffsetY = 0;
  private element: HTMLElement | SVGElement | null = null;
  private callbacks: ZoomPanCallbacks;

  constructor(callbacks: ZoomPanCallbacks) {
    this.callbacks = callbacks;
  }

  attach(element: HTMLElement | SVGElement): void {
    this.element = element;
    element.addEventListener('wheel', this.onWheel as EventListener, { passive: false });
    element.addEventListener('mousedown', this.onMouseDown as EventListener);
    element.addEventListener('mousemove', this.onMouseMove as EventListener);
    element.addEventListener('mouseup', this.onMouseUp as EventListener);
    element.addEventListener('mouseleave', this.onMouseUp as EventListener);
  }

  detach(): void {
    if (!this.element) return;
    this.element.removeEventListener('wheel', this.onWheel as EventListener);
    this.element.removeEventListener('mousedown', this.onMouseDown as EventListener);
    this.element.removeEventListener('mousemove', this.onMouseMove as EventListener);
    this.element.removeEventListener('mouseup', this.onMouseUp as EventListener);
    this.element.removeEventListener('mouseleave', this.onMouseUp as EventListener);
    this.element = null;
  }

  getState(): ViewportState {
    return { ...this.state };
  }

  setState(state: Partial<ViewportState>): void {
    if (state.scale !== undefined) this.state.scale = Math.max(0.1, Math.min(5, state.scale));
    if (state.offsetX !== undefined) this.state.offsetX = state.offsetX;
    if (state.offsetY !== undefined) this.state.offsetY = state.offsetY;
    this.applyTransform();
    this.callbacks.onViewportChange(this.getState());
  }

  zoomIn(factor: number = 1.2): void {
    this.setState({ scale: this.state.scale * factor });
  }

  zoomOut(factor: number = 1.2): void {
    this.setState({ scale: this.state.scale / factor });
  }

  reset(): void {
    this.state = { scale: 1, offsetX: 0, offsetY: 0 };
    this.applyTransform();
    this.callbacks.onViewportChange(this.getState());
  }

  fitToContainer(containerWidth: number, containerHeight: number, contentWidth: number, contentHeight: number): void {
    const sx = containerWidth / contentWidth;
    const sy = containerHeight / contentHeight;
    const s = Math.min(sx, sy) * 0.9;
    const ox = (containerWidth - contentWidth * s) / 2;
    const oy = (containerHeight - contentHeight * s) / 2;
    this.state = { scale: s, offsetX: ox, offsetY: oy };
    this.applyTransform();
    this.callbacks.onViewportChange(this.getState());
  }

  screenToDiagram(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.state.offsetX) / this.state.scale,
      y: (screenY - this.state.offsetY) / this.state.scale,
    };
  }

  private applyTransform(): void {
    if (!this.element) return;
    this.element.style.transform = `translate(${this.state.offsetX}px, ${this.state.offsetY}px) scale(${this.state.scale})`;
    this.element.style.transformOrigin = '0 0';
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, this.state.scale * delta));

    // Zoom toward mouse position
    const rect = (this.element as HTMLElement).parentElement?.getBoundingClientRect();
    if (rect) {
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.state.offsetX = mx - (mx - this.state.offsetX) * (newScale / this.state.scale);
      this.state.offsetY = my - (my - this.state.offsetY) * (newScale / this.state.scale);
    }
    this.state.scale = newScale;
    this.applyTransform();
    this.callbacks.onViewportChange(this.getState());
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      // Middle mouse or Shift+Left for panning
      this.isPanning = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.startOffsetX = this.state.offsetX;
      this.startOffsetY = this.state.offsetY;
      e.preventDefault();
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isPanning) return;
    this.state.offsetX = this.startOffsetX + (e.clientX - this.startX);
    this.state.offsetY = this.startOffsetY + (e.clientY - this.startY);
    this.applyTransform();
    this.callbacks.onViewportChange(this.getState());
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.isPanning = false;
  };
}
