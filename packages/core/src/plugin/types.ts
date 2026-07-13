// =============================================================================
// SelDiA — Plugin System Types
// =============================================================================

import type { DiagramType, DiagramIR } from '../ir/types.js';
import type { DiagramAST } from '../ast/nodes.js';
import type { SelDiAConfig } from '../config.js';
import type { Theme } from '../types/style.js';
export interface LayoutOptions {
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  nodeSpacing?: [number, number];
  rankSpacing?: number;
  [key: string]: any;
}

// -----------------------------------------------------------------------------
// Diagram Plugin Interface
// -----------------------------------------------------------------------------

export interface DiagramPlugin {
  /** Unique plugin identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Plugin version (semver) */
  readonly version: string;

  /** Diagram type this plugin handles */
  readonly diagramType: DiagramType;

  /** Brief description */
  readonly description: string;

  /** Author info */
  readonly author?: string;

  /** Other diagram types this plugin depends on (for C4 which nests levels) */
  readonly dependencies?: DiagramType[];

  // ---- Lifecycle Hooks ----

  /** Called when the plugin is registered */
  onRegister?(registry: PluginRegistry): void | Promise<void>;

  /** Called when the plugin is activated (before first use) */
  onActivate?(config: SelDiAConfig): void | Promise<void>;

  /** Called when the plugin is deactivated */
  onDeactivate?(): void | Promise<void>;

  // ---- Core Functionality ----

  /**
   * Extensions to the core PEG grammar.
   * Return a PEG.js grammar fragment that defines the diagram-type-specific
   * syntax. The fragment is merged into the core grammar at registration.
   */
  getGrammarExtensions?(): GrammarExtension[];

  /**
   * Provide additional AST node types specific to this diagram type.
   * Key = node kind string, Value = constructor/type guard.
   */
  getASTNodeTypes?(): Record<string, unknown>;

  /**
   * Transform diagram-type-specific AST nodes → unified Diagram IR.
   * This is the main workhorse of each plugin.
   *
   * @param ast - The parsed diagram AST
   * @param config - Current SelDiA configuration
   * @returns The Diagram IR ready for layout & rendering
   */
  transform(ast: DiagramAST, config: SelDiAConfig): DiagramIR;

  /**
   * Provide default layout options for this diagram type.
   */
  getDefaultLayoutOptions?(): Partial<LayoutOptions>;

  /**
   * Provide default style overrides for this diagram type within a theme.
   * Called after theme is applied to allow diagram-specific adjustments.
   */
  getThemeOverrides?(theme: Theme): Partial<Theme>;

  /**
   * Validate the AST before transformation.
   * Return diagnostics for any issues found.
   * Return empty array if valid.
   */
  validate?(ast: DiagramAST): PluginDiagnostic[];
}

// -----------------------------------------------------------------------------
// Grammar Extension
// -----------------------------------------------------------------------------

export interface GrammarExtension {
  /** The PEG.js grammar rule name that this extends */
  ruleName: string;

  /** The PEG.js grammar fragment to insert */
  grammar: string;

  /** Position to insert: 'before' | 'after' | 'replace' */
  position: 'before' | 'after' | 'replace';
}

// -----------------------------------------------------------------------------
// Plugin Diagnostic
// -----------------------------------------------------------------------------

export interface PluginDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Node ID that caused the issue, if applicable */
  nodeId?: string;
  /** Source location */
  line?: number;
  column?: number;
  /** Error code for reference */
  code?: string;
}

// -----------------------------------------------------------------------------
// Plugin Registry
// -----------------------------------------------------------------------------

export interface PluginRegistry {
  /** Register a plugin */
  register(plugin: DiagramPlugin): void;

  /** Unregister a plugin */
  unregister(pluginId: string): void;

  /** Get a plugin by diagram type */
  get(type: DiagramType): DiagramPlugin | undefined;

  /** Get a plugin by ID */
  getById(id: string): DiagramPlugin | undefined;

  /** Check if a plugin is registered for a diagram type */
  has(type: DiagramType): boolean;

  /** List all registered plugins */
  list(): ReadonlyArray<DiagramPlugin>;

  /** List all supported diagram types */
  supportedTypes(): ReadonlyArray<DiagramType>;
}

// -----------------------------------------------------------------------------
// Plugin Manager — manages plugin lifecycle
// -----------------------------------------------------------------------------

export interface PluginManager {
  /** The underlying registry */
  readonly registry: PluginRegistry;

  /** Register and activate a plugin */
  install(plugin: DiagramPlugin): Promise<void>;

  /** Deactivate and unregister a plugin */
  uninstall(pluginId: string): Promise<void>;

  /** Activate all installed plugins */
  activateAll(config: SelDiAConfig): Promise<void>;

  /** Deactivate all plugins */
  deactivateAll(): Promise<void>;

  /** Build the merged grammar from all plugins */
  buildMergedGrammar(): string;

  /** Find the plugin that handles a given diagram type */
  findHandler(type: DiagramType): DiagramPlugin | undefined;
}

// -----------------------------------------------------------------------------
// Plugin Metadata (for discovery / marketplace)
// -----------------------------------------------------------------------------

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  keywords: string[];
  diagramTypes: DiagramType[];
  /** Path to the plugin entry module */
  main: string;
  /** Minimum SelDiA core version */
  engineVersion: string;
}
