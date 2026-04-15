import {
  SCREEN_READER_BACKEND_IDS,
  type ScreenReaderBackendId as ActionCatalogScreenReaderBackendId,
} from "@rawstep/action-catalog";

export { SCREEN_READER_BACKEND_IDS };

export type ScreenReaderBackendId = ActionCatalogScreenReaderBackendId;

export type ScreenReaderBrowserPolicy = {
  defaultHeadless: boolean;
  headlessAllowed: boolean;
};

export type ScreenReaderBackendSpec = {
  platforms: readonly NodeJS.Platform[];
  browser: ScreenReaderBrowserPolicy;
  supportsRawPerform: boolean;
};

export const BACKEND_SPEC = {
  "guidepup-voiceover": {
    platforms: ["darwin"],
    browser: {
      defaultHeadless: false,
      headlessAllowed: false,
    },
    supportsRawPerform: true,
  },
  "guidepup-nvda": {
    platforms: ["win32"],
    browser: {
      defaultHeadless: false,
      headlessAllowed: false,
    },
    supportsRawPerform: true,
  },
  "guidepup-virtual": {
    platforms: ["darwin", "linux", "win32"],
    browser: {
      defaultHeadless: true,
      headlessAllowed: true,
    },
    supportsRawPerform: false,
  },
} as const satisfies Record<ScreenReaderBackendId, ScreenReaderBackendSpec>;

export type ScreenReaderBackendsSupportingRawPerform = {
  [BackendId in keyof typeof BACKEND_SPEC]:
    (typeof BACKEND_SPEC)[BackendId]["supportsRawPerform"] extends true ? BackendId : never;
}[keyof typeof BACKEND_SPEC];

export type NamedScreenReaderBackendSpec = {
  id: ScreenReaderBackendId;
} & ScreenReaderBackendSpec;

export function isScreenReaderBackendId(value: unknown): value is ScreenReaderBackendId {
  return typeof value === "string" && (SCREEN_READER_BACKEND_IDS as readonly string[]).includes(value);
}

export function parseScreenReaderBackendId(
  value: unknown,
  label = "screenReaderBackend"
): ScreenReaderBackendId {
  if (isScreenReaderBackendId(value)) {
    return value;
  }

  throw new Error(`${label} must be one of ${formatScreenReaderBackendIdList()}.`);
}

export function findBackendSpecById(id: ScreenReaderBackendId): ScreenReaderBackendSpec {
  return BACKEND_SPEC[id];
}

export function listBackendSpecs(): readonly NamedScreenReaderBackendSpec[] {
  return SCREEN_READER_BACKEND_IDS.map((id) => ({
    id,
    ...BACKEND_SPEC[id],
  }));
}

export function backendSupportsPlatform(
  id: ScreenReaderBackendId,
  platform: NodeJS.Platform
): boolean {
  return findBackendSpecById(id).platforms.includes(platform);
}

export function backendSupportsRawPerform(id: ScreenReaderBackendId): boolean {
  return findBackendSpecById(id).supportsRawPerform;
}

export function getBackendBrowserPolicy(id: ScreenReaderBackendId): ScreenReaderBrowserPolicy {
  return findBackendSpecById(id).browser;
}

export function formatScreenReaderBackendIdList(separator = ", "): string {
  return SCREEN_READER_BACKEND_IDS.join(separator);
}

export function formatQuotedScreenReaderBackendIdList(separator = ", "): string {
  return SCREEN_READER_BACKEND_IDS.map((id) => `"${id}"`).join(separator);
}
