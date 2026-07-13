// =============================================================================
// SelDiA — Inline Plugin Registry Implementation
// =============================================================================

import type { DiagramPlugin, PluginRegistry } from './plugin/types.js';
import type { DiagramType } from './ir/types.js';

export class InlinePluginRegistry implements PluginRegistry {
  private plugins = new Map<string, DiagramPlugin>();
  private byType = new Map<DiagramType, DiagramPlugin>();

  register(plugin: DiagramPlugin): void {
    this.plugins.set(plugin.id, plugin);
    this.byType.set(plugin.diagramType, plugin);
  }

  unregister(pluginId: string): void {
    const p = this.plugins.get(pluginId);
    if (p) {
      this.plugins.delete(pluginId);
      if (this.byType.get(p.diagramType)?.id === pluginId) {
        this.byType.delete(p.diagramType);
      }
    }
  }

  get(type: DiagramType): DiagramPlugin | undefined {
    return this.byType.get(type);
  }

  getById(id: string): DiagramPlugin | undefined {
    return this.plugins.get(id);
  }

  has(type: DiagramType): boolean {
    return this.byType.has(type);
  }

  list(): ReadonlyArray<DiagramPlugin> {
    return Array.from(this.plugins.values());
  }

  supportedTypes(): ReadonlyArray<DiagramType> {
    return Array.from(this.byType.keys());
  }
}
