// =============================================================================
// SelDiA VS Code Extension — Copilot Skill Deployment Types
// =============================================================================

// -----------------------------------------------------------------------------
// Skill Deployment Target — where the skill will be installed
// -----------------------------------------------------------------------------

/** Supported installation scopes for the SelDiA DSL Copilot skill */
export enum SkillDeploymentScope {
  /** Project-level: .github/skills/seldia-dsl/ — shared with the team via Git */
  WORKSPACE = 'workspace',

  /** User-level: ~/.copilot/skills/seldia-dsl/ — personal, roams with settings sync */
  USER = 'user',

  /** Both workspace and user (user asked to install globally, workspace as fallback) */
  BOTH = 'both',
}

// -----------------------------------------------------------------------------
// Skill Deployment Configuration
// -----------------------------------------------------------------------------

export interface SkillDeploymentConfig {
  /** Where to deploy the skill. Default: workspace */
  scope: SkillDeploymentScope;

  /** Whether to auto-deploy on extension activation. Default: true */
  deployOnActivation: boolean;

  /** Whether to prompt the user before deploying. Default: true */
  promptBeforeDeploy: boolean;

  /** Whether to check for skill updates on extension update. Default: true */
  checkForUpdates: boolean;

  /** Whether to overwrite an existing skill of the same name. Default: false (ask) */
  overwriteExisting: boolean | 'ask';
}

// -----------------------------------------------------------------------------
// Skill Manifest — metadata about the deployed skill
// -----------------------------------------------------------------------------

export interface SkillManifest {
  /** Skill name (must match folder name). Always: "seldia-dsl" */
  name: string;

  /** Skill version — tracks which version of the extension deployed it */
  version: string;

  /** The extension version that deployed this skill */
  deployedBy: string;

  /** ISO timestamp of when the skill was deployed */
  deployedAt: string;

  /** Where the skill was deployed */
  scope: SkillDeploymentScope;

  /** Absolute path to the deployed SKILL.md */
  skillPath: string;

  /** SHA-256 hash of the SKILL.md content at deploy time */
  contentHash: string;

  /** Whether this skill is currently active (exists on disk and matches hash) */
  isActive: boolean;
}

// -----------------------------------------------------------------------------
// Skill Deployment Result
// -----------------------------------------------------------------------------

export interface SkillDeploymentResult {
  /** Whether the deployment succeeded */
  success: boolean;

  /** The scope(s) the skill was deployed to */
  deployedTo: SkillDeploymentScope[];

  /** Paths where SKILL.md was written */
  deployedPaths: string[];

  /** If success=false, the error that occurred */
  error?: string;

  /** Whether this was a first-time deploy or an update */
  action: 'created' | 'updated' | 'skipped' | 'failed';

  /** The skill manifest after deployment */
  manifest?: SkillManifest;
}

// -----------------------------------------------------------------------------
// Skill Deployment Status (reported in VS Code status bar)
// -----------------------------------------------------------------------------

export interface SkillStatus {
  /** Whether the SelDiA DSL skill is currently deployed and active */
  isDeployed: boolean;

  /** Where it's deployed */
  scope: SkillDeploymentScope | null;

  /** Path to the active skill */
  skillPath: string | null;

  /** The deployed version (null if not deployed) */
  deployedVersion: string | null;

  /** Whether a newer version is available from the extension */
  updateAvailable: boolean;

  /** Whether the skill content has been modified by the user since deployment */
  isUserModified: boolean;

  /** Last deployment timestamp */
  lastDeployedAt: string | null;
}

// -----------------------------------------------------------------------------
// Skill Provider — abstraction over the deployment mechanism
// -----------------------------------------------------------------------------

export interface SkillProvider {
  /** Get the current deployment status */
  getStatus(): Promise<SkillStatus>;

  /** Deploy the skill to the specified scope(s) */
  deploy(config: SkillDeploymentConfig): Promise<SkillDeploymentResult>;

  /** Remove the deployed skill from the specified scope(s) */
  uninstall(scope: SkillDeploymentScope): Promise<SkillDeploymentResult>;

  /** Check if an updated skill is available from the extension */
  checkForUpdate(): Promise<{ updateAvailable: boolean; currentVersion: string; latestVersion: string }>;

  /** Update the deployed skill to the latest version */
  update(scope: SkillDeploymentScope): Promise<SkillDeploymentResult>;

  /** Get the resolved paths for skill deployment based on scope */
  getDeploymentPaths(scope: SkillDeploymentScope): string[];
}

// -----------------------------------------------------------------------------
// Skill Content — the actual SKILL.md content bundled with the extension
// -----------------------------------------------------------------------------

export interface BundledSkill {
  /** Skill name */
  name: string;

  /** Version (matches extension version) */
  version: string;

  /** Path within the extension bundle: resources/skills/seldia-dsl/SKILL.md */
  bundlePath: string;

  /** The SKILL.md content */
  content: string;

  /** SHA-256 of the content */
  contentHash: string;
}

// -----------------------------------------------------------------------------
// VS Code Settings Contributions (for skill deployment)
// -----------------------------------------------------------------------------

export interface SkillSettings {
  /** Enable/disable the Copilot skill deployment */
  'seldia.copilotSkill.enabled': boolean;

  /** Where to deploy the skill */
  'seldia.copilotSkill.scope': 'workspace' | 'user' | 'both';

  /** Auto-deploy on extension activation */
  'seldia.copilotSkill.autoDeploy': boolean;

  /** Prompt before deploying */
  'seldia.copilotSkill.promptBeforeDeploy': boolean;

  /** Automatically update the skill when the extension updates */
  'seldia.copilotSkill.autoUpdate': boolean;
}

// -----------------------------------------------------------------------------
// Skill Deployment Events (VS Code EventEmitter topics)
// -----------------------------------------------------------------------------

export enum SkillEvent {
  /** Fired when the skill is about to be deployed */
  DEPLOYING = 'seldia:skill:deploying',

  /** Fired after successful deployment */
  DEPLOYED = 'seldia:skill:deployed',

  /** Fired when deployment fails */
  DEPLOY_FAILED = 'seldia:skill:deployFailed',

  /** Fired when the skill is uninstalled */
  UNINSTALLED = 'seldia:skill:uninstalled',

  /** Fired when an update is available */
  UPDATE_AVAILABLE = 'seldia:skill:updateAvailable',

  /** Fired after the skill is updated */
  UPDATED = 'seldia:skill:updated',

  /** Fired when the user manually modifies the deployed skill */
  USER_MODIFIED = 'seldia:skill:userModified',
}
