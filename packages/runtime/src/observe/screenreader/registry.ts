import type {
  ScreenReaderActionPlan,
  ScreenReaderCapabilities
} from "@rawstep/action-catalog";
import {
  SCREEN_READER_BACKEND_IDS,
  backendSupportsPlatform,
  backendSupportsRawPerform,
  findBackendSpecById,
  formatQuotedScreenReaderBackendIdList,
  getBackendBrowserPolicy,
  requiresScreenReaderBackend,
  supportsVisualObservation,
  type ScreenReaderBackendId,
  type UserModel
} from "@rawstep/definition";
import {
  type ScreenReaderBackend,
  type ScreenReaderBackendImplementation,
  type ScreenReaderObservePolicy,
  type ScreenReaderObserveProfile,
  type ScreenReaderObserveProfileName,
  type ScreenReaderRuntime,
  type ScreenReaderRuntimeOptions
} from "./types";
import {
  createGuidepupNvdaBackendImplementation,
  createGuidepupVirtualBackendImplementation,
  createGuidepupVoiceOverBackendImplementation
} from "./backends/guidepup";

export const DEFAULT_SCREEN_READER_OBSERVE_POLICY: ScreenReaderObservePolicy = {
  initial: {
    pollIntervalMs: 120,
    silenceWindowMs: 700,
    maxObserveMs: 6000,
    allowFallback: true
  },
  default: {
    pollIntervalMs: 100,
    silenceWindowMs: 500,
    maxObserveMs: 3000,
    allowFallback: false
  },
  interactive: {
    pollIntervalMs: 120,
    silenceWindowMs: 800,
    maxObserveMs: 5000,
    allowFallback: false
  }
};

export const EMPTY_SCREEN_READER_CAPABILITIES: ScreenReaderCapabilities = createEmptyScreenReaderCapabilities();

const BUILTIN_SCREEN_READER_BACKEND_IMPLEMENTATION_FACTORIES = {
  "guidepup-voiceover": createGuidepupVoiceOverBackendImplementation,
  "guidepup-nvda": createGuidepupNvdaBackendImplementation,
  "guidepup-virtual": createGuidepupVirtualBackendImplementation
} as const satisfies Record<
  ScreenReaderBackendId,
  (options: { supportsRawPerform: boolean }) => ScreenReaderBackendImplementation
>;

const BUILTIN_SCREEN_READER_BACKEND_IMPLEMENTATIONS_BY_ID = Object.fromEntries(
  SCREEN_READER_BACKEND_IDS.map((id) => [
    id,
    BUILTIN_SCREEN_READER_BACKEND_IMPLEMENTATION_FACTORIES[id]({
      supportsRawPerform: backendSupportsRawPerform(id)
    })
  ])
) as Record<ScreenReaderBackendId, ScreenReaderBackendImplementation>;

const BUILTIN_SCREEN_READER_BACKENDS_BY_ID = Object.fromEntries(
  SCREEN_READER_BACKEND_IDS.map((id) => [
    id,
    createScreenReaderBackendEntry(
      id,
      BUILTIN_SCREEN_READER_BACKEND_IMPLEMENTATIONS_BY_ID[id]
    )
  ])
) as Record<ScreenReaderBackendId, ScreenReaderBackend>;

export const BUILTIN_SCREEN_READER_BACKENDS: readonly ScreenReaderBackend[] = SCREEN_READER_BACKEND_IDS.map(
  (id) => BUILTIN_SCREEN_READER_BACKENDS_BY_ID[id]
);

export function listScreenReaderBackends(): readonly ScreenReaderBackend[] {
  return BUILTIN_SCREEN_READER_BACKENDS;
}

export function findScreenReaderBackendById(id: ScreenReaderBackendId): ScreenReaderBackend {
  const backend = BUILTIN_SCREEN_READER_BACKENDS_BY_ID[id];
  if (!backend) {
    throw new Error(`Unknown screen reader backend "${id}".`);
  }

  return backend;
}

export function resolveScreenReaderBackend(
  options: Pick<ScreenReaderRuntimeOptions, "backend" | "backendId">,
  platform: NodeJS.Platform
): ScreenReaderBackend {
  if (options.backend) {
    validateScreenReaderBackendPlatform(options.backend, platform);
    return options.backend;
  }

  if (!options.backendId) {
    throw new Error(
      `screenreader mode requires an explicit screenReaderBackend. Set screenReaderBackend to ${formatQuotedScreenReaderBackendIdList(" or ")}.`
    );
  }

  const backend = findScreenReaderBackendById(options.backendId);
  validateScreenReaderBackendPlatform(backend, platform);
  return backend;
}

export function resolveScreenReaderBrowserHeadless(
  mode: UserModel,
  configuredHeadless?: boolean,
  backendId?: ScreenReaderBackendId
): boolean {
  if (configuredHeadless !== undefined) {
    if (requiresScreenReaderBackend(mode) && configuredHeadless && backendId) {
      const browserPolicy = getBackendBrowserPolicy(backendId);
      if (!browserPolicy.headlessAllowed) {
        throw new Error(
          `Screen reader backend "${backendId}" requires a headed browser. Use --headed or set headless: false.`
        );
      }
    }

    return configuredHeadless;
  }

  if (supportsVisualObservation(mode)) {
    return true;
  }

  if (!backendId) {
    return false;
  }

  return getBackendBrowserPolicy(backendId).defaultHeadless;
}

export function resolveScreenReaderObserveProfiles(
  backend: Pick<ScreenReaderBackend, "observePolicy"> | undefined,
  overrides: Partial<Record<ScreenReaderObserveProfileName, Partial<ScreenReaderObserveProfile>>> = {}
): ScreenReaderObservePolicy {
  const defaults = backend?.observePolicy ?? DEFAULT_SCREEN_READER_OBSERVE_POLICY;

  return {
    initial: { ...defaults.initial, ...overrides.initial },
    default: { ...defaults.default, ...overrides.default },
    interactive: { ...defaults.interactive, ...overrides.interactive }
  };
}

export function resolveScreenReaderCapabilities(args: {
  runtime?: ScreenReaderRuntime;
  actionPlan?: ScreenReaderActionPlan;
  backendId?: ScreenReaderBackendId;
}): ScreenReaderCapabilities {
  if (args.runtime?.capabilities) {
    return args.runtime.capabilities;
  }

  if (args.actionPlan) {
    return findScreenReaderBackendById(args.actionPlan.backendId).capabilities;
  }

  if (args.backendId) {
    return findScreenReaderBackendById(args.backendId).capabilities;
  }

  return createEmptyScreenReaderCapabilities();
}

export function createEmptyScreenReaderCapabilities(): ScreenReaderCapabilities {
  return {
    invoke: {
      next: false,
      previous: false,
      act: false,
      interact: false,
      stopInteracting: false,
      press: false,
      type: false,
      click: false,
      perform: false,
      supportsRawPerform: false
    },
    read: {
      itemText: false,
      itemTextLog: false,
      lastSpokenPhrase: false,
      spokenPhraseLog: false
    },
    maintenance: {
      clearItemTextLog: false,
      clearSpokenPhraseLog: false
    },
    performCatalog: []
  };
}

function createScreenReaderBackendEntry(
  id: ScreenReaderBackendId,
  implementation: ScreenReaderBackendImplementation,
): ScreenReaderBackend {
  const spec = findBackendSpecById(id);

  return {
    id,
    ...implementation,
    ...spec,
    observePolicy: cloneObservePolicy(DEFAULT_SCREEN_READER_OBSERVE_POLICY)
  };
}

function cloneObservePolicy(policy: ScreenReaderObservePolicy): ScreenReaderObservePolicy {
  return {
    initial: { ...policy.initial },
    default: { ...policy.default },
    interactive: { ...policy.interactive }
  };
}

function validateScreenReaderBackendPlatform(
  backend: ScreenReaderBackend,
  platform: NodeJS.Platform
): void {
  if (!backendSupportsPlatform(backend.id, platform)) {
    throw new Error(`Screen reader backend "${backend.id}" is not supported on platform "${platform}".`);
  }
}
