import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
export { id as idSchema };
const text = z.string().trim().min(1).max(16384);
const names = z.array(z.string().min(1).max(100)).max(100);
export const permissionsSchema = z.object({
  keys: names, intents: names, typeText: z.boolean(), replaceText: z.boolean(),
  inputKeys: names.optional(),
}).strict();
export type Permissions = z.infer<typeof permissionsSchema>;
const envName = z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/);
export const providerSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter', 'claudeCode', 'codex', 'opencode', 'grok', 'antigravity', 'custom']);
export type ProviderId = z.infer<typeof providerSchema>;
/** Where models of one provider live. Defined once here so the CLI, the dashboard and the runner agree. */
export type ProviderPreset = {
  label: string;
  /** Absent for `custom`: the model carries its own address. */
  baseURL?: string;
  /** The environment variable that holds the key. Absent for `custom`: the model names its own. */
  keyEnv?: string;
  keyRequired: boolean;
  /** Whether the provider has a model list Rawstep can read; otherwise the model ID is typed by hand. */
  listsModels: boolean;
  /**
   * A coding-agent CLI reached over ACP instead of an address: the command Rawstep starts. Fixed here, never read from the shared
   * config, because it runs a program. The agent's own login pays for the calls, so there is no key.
   */
  agent?: {
    command: string; args: readonly string[];
    /**
     * The ACP sign-in method for agents that keep their own sign-in apart from their CLI (Antigravity). Rawstep calls it only when
     * the person presses the sign-in button, never on its own, because it can reuse or open an account sign-in.
     */
    signIn?: string;
  };
};
/**
 * How hard a coding-agent CLI's model thinks, set per model choice: one of the levels the agent itself offers (ACP `thought_level`;
 * Codex offers low…ultra, Claude Code default…max). Unset keeps the agent's own default, which can be slow (Codex: xhigh).
 * An agent that offers no levels ignores it; one that does refuses a level it does not offer.
 */
const reasoningEffort = z.string().trim().min(1).max(40).optional();
export const PROVIDERS = {
  openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', keyEnv: 'RAWSTEP_OPENAI_API_KEY', keyRequired: true, listsModels: true },
  /** Anthropic's OpenAI-SDK-compatible endpoint. */
  anthropic: { label: 'Anthropic', baseURL: 'https://api.anthropic.com/v1', keyEnv: 'RAWSTEP_ANTHROPIC_API_KEY', keyRequired: true, listsModels: true },
  google: { label: 'Google', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'RAWSTEP_GOOGLE_API_KEY', keyRequired: true, listsModels: true },
  openrouter: { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', keyEnv: 'RAWSTEP_OPENROUTER_API_KEY', keyRequired: true, listsModels: true },
  /** Adapters from the ACP registry, pinned: npx downloads them on first use. */
  claudeCode: { label: 'Claude Code', keyRequired: false, listsModels: true, agent: { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@0.89.1'] } },
  codex: { label: 'Codex', keyRequired: false, listsModels: true, agent: { command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@2.2.2'] } },
  /** Built into the installed CLI. */
  opencode: { label: 'opencode', keyRequired: false, listsModels: true, agent: { command: 'opencode', args: ['acp'] } },
  grok: { label: 'Grok Build', keyRequired: false, listsModels: true, agent: { command: 'grok', args: ['agent', 'stdio'] } },
  /** Google's separate ACP server (not the `agy` CLI): downloaded by the person from the ACP registry and put on PATH. It keeps its own sign-in. */
  antigravity: { label: 'Antigravity', keyRequired: false, listsModels: true, agent: { command: 'agy_acp_server.par', args: [], signIn: 'oauth-personal' } },
  custom: { label: 'Custom (OpenAI-compatible)', keyRequired: false, listsModels: true },
} as const satisfies Record<ProviderId, ProviderPreset>;
/** The providers in the order a person should see them. */
export function providersOf(): { id: ProviderId; preset: ProviderPreset }[] {
  return Object.entries(PROVIDERS).map(([id, preset]) => ({ id: id as ProviderId, preset }));
}
export function providerPreset(model: Pick<Connection, 'provider'>): ProviderPreset {
  return PROVIDERS[model.provider];
}
/** The key variable of a provider that has a fixed one (everything except `custom` and the agent CLIs). */
export const providerKeyEnv = (provider: ProviderId): string | undefined => (PROVIDERS[provider] as ProviderPreset).keyEnv;
/** Preset providers with a key. */
export const KEYED_PROVIDERS: readonly { provider: ProviderId; label: string; keyEnv: string }[] =
  providersOf().filter(p => p.preset.keyEnv).map(p => ({ provider: p.id, label: p.preset.label, keyEnv: p.preset.keyEnv! }));
/**
 * Where language models are reached: a provider preset (fixed address and key variable), a coding-agent CLI or a custom
 * OpenAI-compatible server. A connection holds no model: the planner, analysis and suggestions pick the model ID on a connection.
 */
export const connectionSchema = z.object({
  id, name: text, provider: providerSchema,
  /** Only for `custom`: the OpenAI-compatible server address. */
  baseURL: z.url().optional(),
  /** Only for `custom`: the environment variable that holds its key, if it needs one. */
  apiKeyEnv: envName.optional(),
  timeoutMs: z.number().int().min(100).max(600000).default(RAWSTEP_DEFAULTS.modelTimeoutMs),
}).strict().superRefine((connection, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (connection.provider === 'custom' ? !connection.baseURL : connection.baseURL !== undefined) issue('baseURL', 'Only custom connections have a baseURL, and they need one.');
  if (connection.provider !== 'custom' && connection.apiKeyEnv !== undefined) issue('apiKeyEnv', 'Only custom connections name their own key variable.');
});
export type Connection = z.infer<typeof connectionSchema>;
/** An LLM on a connection (planner, analysis or check suggestions). */
export const analysisChoiceSchema = z.object({ connectionId: id, modelId: text, reasoningEffort }).strict();
export type AnalysisChoice = z.infer<typeof analysisChoiceSchema>;
const count = (min: number, max: number, fallback: number) => z.number().int().min(min).max(max).default(fallback);
/**
 * When a run stops early and when orchestration asks for a new plan. Each run profile holds a full set; a run may override fields
 * for itself only (the CLI's --rule). Every run records the rules it ran with, because they change how runs end.
 */
export const runRulesSchema = z.object({
  /**
   * Whether a run stops as stuck when it keeps repeating itself: the same action producing the same exact speech (for example `next`
   * answering "End of content") is a loop, never page progress.
   */
  repetitionGuard: z.boolean().default(true),
  /** The same action producing the same speech this many times in a row stops the run as stuck. */
  maxUnchangedTransitions: count(1, 10000, RAWSTEP_DEFAULTS.policy.maxUnchangedTransitions),
  /**
   * Actions the run goes on after the goal is reached when the user heard nothing saying so (a confirmation shown
   * but not announced). 0 stops at once, as before. The extra actions are the user's not knowing whether it worked.
   */
  confirmationGrace: count(0, 100, 5),
  /**
   * With a planner: planner calls a run may make (plans, questions about a heard item, and asking again after an unusable reply). A cost limit: a run that reaches it ends unmeasured (it is
   * not known whether the task can be done), never as the user failing. The user gives up only by the planner's own decision.
   */
  maxPlannerCalls: count(1, 1000, RAWSTEP_DEFAULTS.orchestration.maxPlannerCalls),
  /** With a planner: moves since the planner last looked before it takes stock of the effort spent (keep going, change, or give up). */
  reviewEvery: count(1, 10000, RAWSTEP_DEFAULTS.orchestration.reviewEvery),
  /** With a planner: actions on one task without hearing anything new before a new plan is requested. */
  stepActionLimit: count(1, 1000, RAWSTEP_DEFAULTS.orchestration.stepActionLimit),
  /** With a planner: failed actions in a row on one task before a new plan is requested. */
  failureLimit: count(1, 100, 2),
  /** With a planner: actions in a row on one task that changed nothing before a new plan is requested. */
  noChangeLimit: count(1, 100, 3),
  /**
   * With a planner: past actions the planner is given when it plans, each with what was heard before it. Older ones are forgotten;
   * the plan document it wrote stays. Lower it for a user who does not remember the whole page.
   */
  plannerHistoryLimit: count(1, 10000, RAWSTEP_DEFAULTS.orchestration.plannerHistoryLimit),
  /**
   * With a planner: what the simulated user does before the first plan. `headings` (default) lists the page's headings, as a
   * VoiceOver user who finds things by headings opens the rotor first, as the first action, counted as a step. It happens only for
   * actions that allow the `headings.list` intent (finding by headings): a user who reads item by item walks from the top, so missing
   * headings do not slow them down, while they do slow one who finds by headings. `none` never surveys.
   */
  survey: z.enum(['none', 'headings']).default('headings'),
}).strict();
export type RunRules = z.infer<typeof runRulesSchema>;
/**
 * Overrides of some run rules for particular runs. Unlike `runRulesSchema.partial()`, it fills in nothing:
 * a field left out stays out, so it cannot override the layers below with a default.
 */
export const runRulesOverrideSchema = z.object({
  repetitionGuard: z.boolean().optional(),
  maxUnchangedTransitions: z.number().int().min(1).max(10000).optional(),
  confirmationGrace: z.number().int().min(0).max(100).optional(),
  maxPlannerCalls: z.number().int().min(1).max(1000).optional(),
  reviewEvery: z.number().int().min(1).max(10000).optional(),
  stepActionLimit: z.number().int().min(1).max(1000).optional(),
  failureLimit: z.number().int().min(1).max(100).optional(),
  noChangeLimit: z.number().int().min(1).max(100).optional(),
  plannerHistoryLimit: z.number().int().min(1).max(10000).optional(),
  survey: z.enum(['none', 'headings']).optional(),
}).strict();
export type RunRulesOverride = z.infer<typeof runRulesOverrideSchema>;
/**
 * The LLM that plans. `instructions` are added to Rawstep's planner rules (plan document format, plan only from what was heard
 * and with the listed actions), never replacing them. They must not carry page knowledge a real user would not have, or the run
 * stops measuring how hard the page is to find one's way around.
 */
export const llmPlannerSchema = z.object({ connectionId: id, modelId: text, reasoningEffort, instructions: z.string().max(16384).default('') }).strict();
/**
 * A plan written beforehand instead of a planner model: a project-relative JSON file in the plan draft format (phases of tasks with
 * their cues). `{task}` in the path is the task file's name without `.json`, so one profile can give every task its own plan
 * (`plans/{task}/L2.json`). The plan never changes during a run; a stuck task is abandoned and the next one starts.
 */
export const filePlannerSchema = z.object({ planFile: z.string().trim().min(1).max(500).refine(path => path.endsWith('.json'), 'A plan file is a .json file.') }).strict();
export const plannerSchema = z.union([llmPlannerSchema, filePlannerSchema]);
export type PlannerChoice = z.infer<typeof plannerSchema>;
export type LlmPlannerChoice = z.infer<typeof llmPlannerSchema>;
export const isFilePlanner = (planner: PlannerChoice | undefined): planner is z.infer<typeof filePlannerSchema> => !!planner && 'planFile' in planner;
/** The plan file a task reads under a file planner: `{task}` becomes the task file's name without `.json`. */
export const planFileOf = (planner: z.infer<typeof filePlannerSchema>, task: Pick<ManagedTask, 'file'>): string =>
  planner.planFile.replaceAll('{task}', task.file.replace(/^.*\//, '').replace(/\.json$/, ''));
/**
 * Who decides, as a part of a run profile. A run always plans: the planner (an LLM, or a plan file) writes a plan document and
 * Rawstep carries out one task at a time. A profile without a planner cannot run until one is picked.
 */
const deciding = {
  planner: plannerSchema.optional(),
};
/** The deciding part of a profile as a run records it. */
export const comboSchema = z.object({ id, name: text, ...deciding }).strict();
export type Combo = z.infer<typeof comboSchema>;
/** What the simulated user may do: screen reader intents, keys and named-input typing. */
export const actionSetSchema = z.object({ id, name: text, actions: permissionsSchema }).strict();
export type ActionSet = z.infer<typeof actionSetSchema>;
/** Page conditions: a built-in profile name ('default', 'narrow', …) or an object, resolved by @rawstep/browser/profiles. */
export const pageEnvironmentSchema = z.object({ id, name: text, profile: z.unknown() }).strict();
export type PageEnvironment = z.infer<typeof pageEnvironmentSchema>;
export const atBackendSchema = z.enum(['simulation', 'voiceover', 'nvda']);
export type AtBackend = z.infer<typeof atBackendSchema>;
/** The assistive technology a run goes through: Rawstep's simulation or a native screen reader over AT Driver. */
export const atEnvironmentSchema = z.object({ id, name: text, backend: atBackendSchema }).strict();
export type AtEnvironment = z.infer<typeof atEnvironmentSchema>;
/**
 * A run profile: who the simulated user is and how a run goes, under one name — who plans, what the user may do, the page environment, the screen reader, and the run rules. A task says only what to do; a run is a task
 * with a profile, picked when the run starts. There is no layer between Rawstep's defaults and a profile.
 */
export const profileSchema = z.object({
  id, name: text,
  ...deciding,
  actions: permissionsSchema,
  /** A built-in page environment name ('default', 'narrow', …) or an object, resolved by @rawstep/browser/profiles. */
  page: z.unknown().default('default'),
  /** The assistive technology the run goes through. */
  screenReader: atBackendSchema.default('simulation'),
  runRules: runRulesSchema.default(() => runRulesSchema.parse({})),
}).strict();
export type Profile = z.infer<typeof profileSchema>;
export const taskSchema = z.object({
  id, name: text, file: z.string().min(1).max(500),
  /**
   * The task this one is a broken version of: the same goal on a copy of its page with one accessibility defect (no button name, no
   * status message). Results show the extra moves against that task. One level only: a variant has no variants of its own.
   */
  variantOf: id.optional(),
  /** The fewest moves the goal takes, as a person counted or measured it; results show moves against it. */
  minimalSteps: z.number().int().min(1).max(10000).optional(),
  /** Overrides the project's analysis instructions for this task. */
  analysisInstructions: z.string().max(16384).optional(),
}).strict();
export type ManagedTask = z.infer<typeof taskSchema>;
/** Settings shared by the project that never change an outcome: the default analysis LLM and the model that suggests completion checks. */
export const projectSettingsSchema = z.object({
  analysis: z.object({
    /** Without one (and without a combo's own), only the built-in rule-based analysis runs. */
    model: analysisChoiceSchema.optional(),
    instructions: z.string().max(16384).default(''),
  }).strict().default({ instructions: '' }),
  /** Suggests completion checks while a task is written; the analysis model when unset. */
  suggestions: z.object({ model: analysisChoiceSchema.optional() }).strict().default({}),
}).strict();
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
/** Settings that belong to the computer running Rawstep, not to an experiment. */
export const machineSchema = z.object({
  /** AT Driver WebSocket addresses of the native screen readers; empty means the usual address of that server (`atEndpointOf`). */
  atEndpoints: z.object({ voiceover: z.string().default(''), nvda: z.string().default('') }).strict().default({ voiceover: '', nvda: '' }),
  browserExecutablePath: z.string().default(''), headless: z.boolean().default(true),
  /**
   * A Chrome you started yourself with `--remote-debugging-port` (e.g. `http://localhost:9222`). Runs connect to it instead of
   * launching one, so sites see an ordinary browser; each run gets its own isolated context there. Empty launches a browser.
   */
  browserEndpoint: z.string().default(''),
  /**
   * For real sites with a human check (Cloudflare and the like): runs use a visible Chrome with a profile kept in
   * `.rawstep/browser-profile`, and pause while a person passes the check in that window. Rawstep never answers a check itself.
   */
  personCheck: z.boolean().default(false),
}).strict();
export type MachineSettings = z.infer<typeof machineSchema>;
/** Where each native screen reader's AT Driver server listens unless told otherwise: Bocoup's macOS server and the PAC NVDA server. */
export const AT_DRIVER_DEFAULTS = { voiceover: 'ws://localhost:4382/session', nvda: 'ws://localhost:3031/session' } as const;
/** The AT Driver address a native screen reader run connects to; empty for the simulation. */
export const atEndpointOf = (machine: Pick<MachineSettings, 'atEndpoints'>, backend: AtBackend): string => backend === 'simulation' ? '' : machine.atEndpoints[backend].trim() || AT_DRIVER_DEFAULTS[backend];
/** The .env.local variable holding the command that starts the AT Driver server on this computer (never in the shared config: it runs a program). */
export const AT_DRIVER_COMMAND_ENV = 'RAWSTEP_AT_DRIVER_COMMAND';
export const configSchema = z.object({
  version: z.literal(7),
  connections: z.array(connectionSchema).max(100),
  profiles: z.array(profileSchema).min(1).max(500),
  tasks: z.array(taskSchema).max(500),
  project: projectSettingsSchema.default(() => projectSettingsSchema.parse({})),
  machine: machineSchema,
}).strict().superRefine((config, ctx) => {
  const ids = new Set<string>();
  config.connections.forEach((c, i) => { if (ids.has(c.id)) ctx.addIssue({ code: 'custom', path: ['connections', i, 'id'], message: `Connection id ${c.id} is used twice.` }); ids.add(c.id); });
  const known = (choice: { connectionId: string } | undefined) => !choice || ids.has(choice.connectionId);
  config.profiles.forEach((profile, i) => {
    if (!isFilePlanner(profile.planner) && !known(profile.planner)) ctx.addIssue({ code: 'custom', path: ['profiles', i, 'planner', 'connectionId'], message: `Profile ${profile.name} plans with a connection that does not exist.` });
  });
  if (!known(config.project.analysis.model)) ctx.addIssue({ code: 'custom', path: ['project', 'analysis', 'model', 'connectionId'], message: 'Post-run analysis uses a connection that does not exist.' });
  if (!known(config.project.suggestions.model)) ctx.addIssue({ code: 'custom', path: ['project', 'suggestions', 'model', 'connectionId'], message: 'Check suggestions use a connection that does not exist.' });
});
export type ProjectConfig = z.infer<typeof configSchema>;
/**
 * A model as a run calls it: a connection plus the model ID a profile picked. `id` is the connection's, so keys and checks are per
 * connection.
 */
export type Model = Pick<Connection, 'id' | 'provider' | 'baseURL' | 'apiKeyEnv' | 'timeoutMs'> & { name: string; modelId: string; reasoningEffort?: string };
/** Instructions as a run records them: `id` and `version` identify them in policy evidence. */
export type Prompt = { id: string; name: string; version: string; instructions: string };
export const CONFIG_FILE = 'rawstep.config.json';
/** The agent CLI a connection starts, when it is one; such a connection has no address or key. */
export const agentOf = (model: Pick<Connection, 'provider'>): ProviderPreset['agent'] => providerPreset(model).agent;
/** Where the model is called: the preset address of its provider, or the address a custom connection carries. */
export const resolveBaseURL = (model: Pick<Connection, 'provider' | 'baseURL'>): string => providerPreset(model).baseURL ?? model.baseURL!;
/** The environment variable that holds the connection's key, if it has one. */
export const modelKeyEnv = (model: Pick<Connection, 'provider' | 'apiKeyEnv'>): string | undefined => model.provider === 'custom' ? model.apiKeyEnv : providerPreset(model).keyEnv;
export const modelKeyRequired = (model: Pick<Connection, 'provider'>): boolean => providerPreset(model).keyRequired;
/** The key a connection uses, as shown in `credentialStatus`: one per preset provider, one per custom connection. */
export const credentialId = (connection: Pick<Connection, 'id' | 'provider'>): string => connection.provider === 'custom' ? `connection:${connection.id}` : `provider:${connection.provider}`;
/** Every key the config's connections use, once per variable, for status displays and `rawstep doctor`. */
export function credentialRequirements(config: Pick<ProjectConfig, 'connections'>): { id: string; label: string; env?: string; required: boolean; connection: Connection }[] {
  const seen = new Map<string, { id: string; label: string; env?: string; required: boolean; connection: Connection }>();
  for (const connection of config.connections) {
    const id = credentialId(connection), env = modelKeyEnv(connection);
    if (!seen.has(id)) seen.set(id, { id, label: connection.provider === 'custom' ? connection.name : providerPreset(connection).label, ...(env ? { env } : {}), required: modelKeyRequired(connection), connection });
  }
  return [...seen.values()];
}
/** How a run names a model: connection and model ID, and the reasoning effort when one is set. */
const modelName = (connection: Pick<Connection, 'name'>, choice: { modelId: string; reasoningEffort?: string | undefined }) =>
  `${connection.name} · ${choice.modelId}${choice.reasoningEffort ? ` (${choice.reasoningEffort})` : ''}`;
/** An LLM choice joined with its connection; undefined when there is none or the connection is gone. */
function llmOf(config: Pick<ProjectConfig, 'connections'>, choice: AnalysisChoice | undefined): Model | undefined {
  const connection = choice && config.connections.find(c => c.id === choice.connectionId);
  if (!choice || !connection) return undefined;
  return { ...structuredClone(connection), name: modelName(connection, choice), modelId: choice.modelId, ...(choice.reasoningEffort ? { reasoningEffort: choice.reasoningEffort } : {}) };
}
/** The LLM a profile plans with; undefined for a plan file or no planner yet. */
export const comboPlanner = (config: Pick<ProjectConfig, 'connections'>, combo: Pick<Combo, 'planner'>): Model | undefined => !isFilePlanner(combo.planner) ? llmOf(config, combo.planner) : undefined;
/** The LLM the project analyses runs with by default. */
export const projectAnalysisModel = (config: Pick<ProjectConfig, 'connections' | 'project'>): Model | undefined => llmOf(config, config.project.analysis.model);
/** The LLM that suggests completion checks: its own setting, otherwise the analysis model. */
export const suggestionModel = (config: Pick<ProjectConfig, 'connections' | 'project'>): Model | undefined => llmOf(config, config.project.suggestions.model) ?? projectAnalysisModel(config);
/** What a person picks to look up models: a provider and, for custom, the address. */
export const discoverRequestSchema = z.object({ provider: providerSchema, baseURL: z.url().optional(), apiKey: z.string().max(16384).optional() }).strict();
export type DiscoverRequest = z.infer<typeof discoverRequestSchema>;
/** The actions a new project starts with: basic reading. */
export const DEFAULT_PERMISSIONS: Permissions = { keys: [], intents: ['next', 'previous', 'activate'], typeText: true, replaceText: false };
export function defaultProfile(id = 'default', name = 'Default'): Profile {
  return profileSchema.parse({ id, name, actions: structuredClone(DEFAULT_PERMISSIONS) });
}
export function defaultConfig(): ProjectConfig {
  return configSchema.parse({ version: 7, connections: [], tasks: [], profiles: [defaultProfile()], machine: {} });
}
export function parseConfig(raw: unknown): ProjectConfig { return configSchema.parse(raw); }
/** The profile a run uses when none is named: the project's first. */
export function firstProfile(config: Pick<ProjectConfig, 'profiles'>): Profile {
  return config.profiles[0]!;
}
/** The conditions a run is made of, read off a profile: the deciding part, the actions and both environments, each named after it. */
export type Conditions = { profile: Profile; combo: Combo; actionSet: ActionSet; pageEnvironment: PageEnvironment; atEnvironment: AtEnvironment };
export function profileConditions(profile: Profile): Conditions {
  const { id, name } = profile;
  return {
    profile,
    combo: { id, name, ...(profile.planner ? { planner: profile.planner } : {}) },
    actionSet: { id, name, actions: profile.actions },
    pageEnvironment: { id, name, profile: profile.page },
    atEnvironment: { id, name, backend: profile.screenReader },
  };
}
/** The rules a run uses: the profile's, then any overrides for these runs only. */
export function resolveRunRules(profile: Pick<Profile, 'runRules'>, ...overrides: (RunRulesOverride | undefined)[]): RunRules {
  return runRulesSchema.parse(Object.assign({}, profile.runRules, ...overrides.filter(Boolean)));
}
/** What a run snapshot keeps besides the conditions: this computer's settings, the rules and the analysis instructions. */
export type RunSettings = { machine: MachineSettings; runRules: RunRules; analysisInstructions: string };
export function resolveRunSettings(config: ProjectConfig, task: Pick<ManagedTask, 'analysisInstructions'>, profile: Pick<Profile, 'runRules'>, runRules?: RunRulesOverride): RunSettings {
  return { machine: structuredClone(config.machine), runRules: resolveRunRules(profile, runRules),
    analysisInstructions: task.analysisInstructions?.trim() || config.project.analysis.instructions };
}
/** A connection, profile or other configured entry by its id, otherwise by its (case-sensitive) name. */
export function findByIdOrName<T extends { id: string; name: string }>(list: readonly T[], reference: string): T | undefined {
  return list.find(item => item.id === reference) ?? list.find(item => item.name === reference);
}
