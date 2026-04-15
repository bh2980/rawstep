import type {
  ScreenReaderActionPlan,
  ScreenReaderCapabilities
} from "@rawstep/action-catalog";
import type { UserModel } from "@rawstep/definition";
import {
  SCREEN_READER_BACKEND_IDS,
  type ScreenReaderBackend,
  type ScreenReaderBackendId,
  type ScreenReaderBackendImplementation,
  type ScreenReaderBrowserPolicy,
  type ScreenReaderObservePolicy,
  type ScreenReaderObserveProfile,
  type ScreenReaderObserveProfileName,
  type ScreenReaderRuntime,
  type ScreenReaderRuntimeOptions
} from "./types";
import {
  guidepupNvdaBackendImplementation,
  guidepupVirtualBackendImplementation,
  guidepupVoiceOverBackendImplementation
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

const BUILTIN_SCREEN_READER_BACKENDS_BY_ID = {
  "guidepup-voiceover": createScreenReaderBackendEntry(
    guidepupVoiceOverBackendImplementation,
    {
      defaultHeadless: false,
      headlessAllowed: false
    }
  ),
  "guidepup-nvda": createScreenReaderBackendEntry(
    guidepupNvdaBackendImplementation,
    {
      defaultHeadless: false,
      headlessAllowed: false
    }
  ),
  "guidepup-virtual": createScreenReaderBackendEntry(
    guidepupVirtualBackendImplementation,
    {
      defaultHeadless: true,
      headlessAllowed: true
    }
  )
} as const satisfies Record<ScreenReaderBackendId, ScreenReaderBackend>;

export const BUILTIN_SCREEN_READER_BACKENDS: readonly ScreenReaderBackend[] = SCREEN_READER_BACKEND_IDS.map(
  (id) => BUILTIN_SCREEN_READER_BACKENDS_BY_ID[id]
);

export const guidepupVoiceOverBackend = BUILTIN_SCREEN_READER_BACKENDS_BY_ID["guidepup-voiceover"];
export const guidepupNvdaBackend = BUILTIN_SCREEN_READER_BACKENDS_BY_ID["guidepup-nvda"];
export const guidepupVirtualBackend = BUILTIN_SCREEN_READER_BACKENDS_BY_ID["guidepup-virtual"];

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
      'screenreader mode requires an explicit screenReaderBackend. Set screenReaderBackend to "guidepup-voiceover", "guidepup-nvda", or "guidepup-virtual".'
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
    if (mode !== "keyboard" && configuredHeadless && backendId) {
      const backend = findScreenReaderBackendById(backendId);
      if (!backend.browserPolicy.headlessAllowed) {
        throw new Error(
          `Screen reader backend "${backendId}" requires a headed browser. Use --headed or set headless: false.`
        );
      }
    }

    return configuredHeadless;
  }

  if (mode === "keyboard") {
    return true;
  }

  if (!backendId) {
    return false;
  }

  return findScreenReaderBackendById(backendId).browserPolicy.defaultHeadless;
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
  implementation: ScreenReaderBackendImplementation,
  browserPolicy: ScreenReaderBrowserPolicy
): ScreenReaderBackend {
  return {
    ...implementation,
    browserPolicy,
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
  if (!backend.supports(platform)) {
    throw new Error(`Screen reader backend "${backend.id}" is not supported on platform "${platform}".`);
  }
}
