import type {
  ScreenReaderActionPlan,
  ScreenReaderCapabilities
} from "@rawstep/action-catalog";
import {
  SCREEN_READER_BACKEND_IDS,
  backendSupportsPlatform,
  findBackendSpecById,
  formatQuotedScreenReaderBackendIdList,
  getBackendBrowserPolicy,
  requiresScreenReaderBackend,
  supportsVisualObservation,
  type ScreenReaderBackendId,
  type ScreenReaderObserveConfig,
  type UserModel
} from "@rawstep/definition";
import {
  type ScreenReaderBackend,
  type ScreenReaderBackendImplementation,
  type ScreenReaderObserveProfile,
  type ScreenReaderRuntime,
  type ScreenReaderRuntimeOptions
} from "./types";
import {
  createGuidepupNvdaBackendImplementation,
  createGuidepupVirtualBackendImplementation,
  createGuidepupVoiceOverBackendImplementation
} from "./backends/guidepup";

export const DEFAULT_SCREEN_READER_OBSERVE_PROFILE: ScreenReaderObserveProfile = {
  pollIntervalMs: 100,
  silenceWindowMs: 1200,
  maxObserveMs: 7000,
  allowFallback: false
};

export const EMPTY_SCREEN_READER_CAPABILITIES: ScreenReaderCapabilities = createEmptyScreenReaderCapabilities();

const BUILTIN_SCREEN_READER_BACKEND_IMPLEMENTATION_FACTORIES = {
  "guidepup-voiceover": createGuidepupVoiceOverBackendImplementation,
  "guidepup-nvda": createGuidepupNvdaBackendImplementation,
  "guidepup-virtual": createGuidepupVirtualBackendImplementation
} as const satisfies Record<
  ScreenReaderBackendId,
  () => ScreenReaderBackendImplementation
>;

const BUILTIN_SCREEN_READER_BACKEND_IMPLEMENTATIONS_BY_ID = Object.fromEntries(
  SCREEN_READER_BACKEND_IDS.map((id) => [
    id,
    BUILTIN_SCREEN_READER_BACKEND_IMPLEMENTATION_FACTORIES[id]()
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

export function resolveScreenReaderObserveProfile(
  backend: Pick<ScreenReaderBackend, "observeProfile"> | undefined,
  overrides: ScreenReaderObserveConfig = {}
): ScreenReaderObserveProfile {
  return {
    ...(backend?.observeProfile ?? DEFAULT_SCREEN_READER_OBSERVE_PROFILE),
    ...overrides
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
    observeProfile: cloneObserveProfile(DEFAULT_SCREEN_READER_OBSERVE_PROFILE)
  };
}

function cloneObserveProfile(profile: ScreenReaderObserveProfile): ScreenReaderObserveProfile {
  return { ...profile };
}

function validateScreenReaderBackendPlatform(
  backend: ScreenReaderBackend,
  platform: NodeJS.Platform
): void {
  if (!backendSupportsPlatform(backend.id, platform)) {
    throw new Error(`Screen reader backend "${backend.id}" is not supported on platform "${platform}".`);
  }
}
