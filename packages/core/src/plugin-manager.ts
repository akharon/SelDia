// =============================================================================
// SelDiA — Plugin Manager Implementation
// =============================================================================

import type { DiagramPlugin, PluginManager, PluginRegistry } from './plugin/types.js';
import type { SelDiAConfig } from './config.js';
import type { DiagramType } from './ir/types.js';
import { InlinePluginRegistry } from './registry.js';

export class DefaultPluginManager implements PluginManager {
  readonly registry: PluginRegistry;

  constructor() {
    this.registry = new InlinePluginRegistry();
  }

  async install(plugin: DiagramPlugin): Promise<void> {
    this.registry.register(plugin);
    if (plugin.onRegister) {
      await plugin.onRegister(this.registry);
    }
    // Note: activation is handled separately
  }

  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.registry.getById(pluginId);
    if (plugin?.onDeactivate) {
      await plugin.onDeactivate();
    }
    this.registry.unregister(pluginId);
  }

  async activateAll(config: SelDiAConfig): Promise<void> {
    for (const plugin of this.registry.list()) {
      if (plugin.onActivate) {
        await plugin.onActivate(config);
      }
    }
  }

  async deactivateAll(): Promise<void> {
    for (const plugin of this.registry.list()) {
      if (plugin.onDeactivate) {
        await plugin.onDeactivate();
      }
    }
  }

  buildMergedGrammar(): string {
    // In a full implementation, this merges grammar fragments from plugins
    return '';
  }

  findHandler(type: DiagramType): DiagramPlugin | undefined {
    return this.registry.get(type);
  }
}
