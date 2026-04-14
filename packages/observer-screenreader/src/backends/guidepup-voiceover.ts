import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import {
  getGuidepupNvdaCapabilities,
  getGuidepupVirtualCapabilities,
  getGuidepupVoiceOverCapabilities,
  resolveGuidepupNvdaPerformCommand,
  resolveGuidepupVoiceOverPerformCommand
} from "@rawstep/guidepup-capabilities";
import type {
  ClickOptions,
  CommandOptions,
  KeyboardOptions,
  ScreenReaderAction
} from "@rawstep/core";
import type { Page } from "playwright";
import type { ScreenReaderBackend, ScreenReaderSession } from "../types";

type GuidepupClickOptions = {
  button?: "left" | "right";
  clickCount?: 1 | 2 | 3;
};

type GuidepupScreenReaderApi = {
  start(options?: CommandOptions): Promise<void>;
  stop(options?: CommandOptions): Promise<void>;
  next(options?: CommandOptions): Promise<void>;
  previous(options?: CommandOptions): Promise<void>;
  act(options?: CommandOptions): Promise<void>;
  interact(options?: CommandOptions): Promise<void>;
  stopInteracting(options?: CommandOptions): Promise<void>;
  perform(command: unknown, options?: CommandOptions): Promise<void>;
  press(key: string, options?: KeyboardOptions): Promise<void>;
  type(text: string, options?: KeyboardOptions): Promise<void>;
  click(options?: GuidepupClickOptions & CommandOptions): Promise<void>;
  itemText(): Promise<string>;
  lastSpokenPhrase(): Promise<string>;
  itemTextLog(): Promise<string[]>;
  spokenPhraseLog(): Promise<string[]>;
  clearItemTextLog(): Promise<void>;
  clearSpokenPhraseLog(): Promise<void>;
};

type GuidepupVoiceOverApi = GuidepupScreenReaderApi & {
  keyboardCommands: Record<string, unknown>;
};

type GuidepupNVDAApi = GuidepupScreenReaderApi & {
  keyboardCommands: Record<string, unknown>;
};

type GuidepupModule = {
  voiceOver: GuidepupVoiceOverApi;
  nvda: GuidepupNVDAApi;
};

type GuidepupVirtualAdapter = {
  start(options?: CommandOptions): Promise<void>;
  stop(options?: CommandOptions): Promise<void>;
  next(options?: CommandOptions): Promise<void>;
  previous(options?: CommandOptions): Promise<void>;
  act(options?: CommandOptions): Promise<void>;
  interact(options?: CommandOptions): Promise<void>;
  stopInteracting(options?: CommandOptions): Promise<void>;
  perform(action: Extract<ScreenReaderAction, { kind: "invoke"; method: "perform" }>): Promise<void>;
  press(input: { key: string; options?: KeyboardOptions }): Promise<void>;
  type(input: { text: string; options?: KeyboardOptions }): Promise<void>;
  click(options?: ClickOptions): Promise<void>;
  itemText(): Promise<string>;
  lastSpokenPhrase(): Promise<string>;
  itemTextLog(): Promise<string[]>;
  spokenPhraseLog(): Promise<string[]>;
  clearItemTextLog(): Promise<void>;
  clearSpokenPhraseLog(): Promise<void>;
};

const GUIDEPUP_VIRTUAL_ADAPTER_GLOBAL = "__rawstepGuidepupVirtualAdapter";
const requireFromHere = createRequire(__filename);
const GUIDEPUP_VIRTUAL_BROWSER_BUNDLE_PATH = requireFromHere.resolve("@guidepup/virtual-screen-reader/browser.js");
const GUIDEPUP_VIRTUAL_ADAPTER_INSTALL_TIMEOUT_MS = 1_000;
const GUIDEPUP_VIRTUAL_ADAPTER_INSTALL_POLL_MS = 10;

let guidepupVirtualAdapterScriptPromise: Promise<string> | undefined;

export const guidepupVoiceOverBackend: ScreenReaderBackend = {
  id: "guidepup-voiceover",
  capabilities: getGuidepupVoiceOverCapabilities(),
  supports(platform) {
    return platform === "darwin";
  },
  async createSession(_page: Page): Promise<ScreenReaderSession> {
    const { voiceOver } = await import("@guidepup/guidepup") as unknown as GuidepupModule;
    return new GuidepupVoiceOverSession(voiceOver);
  }
};

export const guidepupNvdaBackend: ScreenReaderBackend = {
  id: "guidepup-nvda",
  capabilities: getGuidepupNvdaCapabilities(),
  supports(platform) {
    return platform === "win32";
  },
  async createSession(_page: Page): Promise<ScreenReaderSession> {
    const { nvda } = await import("@guidepup/guidepup") as unknown as GuidepupModule;
    return new GuidepupNVDASession(nvda);
  }
};

export const guidepupVirtualBackend: ScreenReaderBackend = {
  id: "guidepup-virtual",
  capabilities: getGuidepupVirtualCapabilities(),
  supports() {
    return true;
  },
  async createSession(page: Page): Promise<ScreenReaderSession> {
    return new GuidepupVirtualSession(page);
  }
};

class GuidepupVoiceOverSession implements ScreenReaderSession {
  constructor(private readonly voiceOver: GuidepupVoiceOverApi) {}

  async start(options?: CommandOptions): Promise<void> {
    await this.voiceOver.start(options);
  }

  async stop(options?: CommandOptions): Promise<void> {
    await this.voiceOver.stop(options);
  }

  async next(options?: CommandOptions): Promise<void> {
    await this.voiceOver.next(options);
  }

  async previous(options?: CommandOptions): Promise<void> {
    await this.voiceOver.previous(options);
  }

  async act(options?: CommandOptions): Promise<void> {
    await this.voiceOver.act(options);
  }

  async interact(options?: CommandOptions): Promise<void> {
    await this.voiceOver.interact(options);
  }

  async stopInteracting(options?: CommandOptions): Promise<void> {
    await this.voiceOver.stopInteracting(options);
  }

  async perform(command: unknown, options?: CommandOptions): Promise<void> {
    await this.voiceOver.perform(
      resolveGuidepupPerformPayload(command, {
        resolveCatalog: (id) => resolveGuidepupVoiceOverPerformCommand(id, this.voiceOver.keyboardCommands),
        backendLabel: "Guidepup VoiceOver",
        supportsRawPerform: true
      }),
      options
    );
  }

  async press(key: string, options?: KeyboardOptions): Promise<void> {
    await this.voiceOver.press(key, options);
  }

  async type(text: string, options?: KeyboardOptions): Promise<void> {
    await this.voiceOver.type(text, options);
  }

  async click(options?: ClickOptions): Promise<void> {
    await this.voiceOver.click(normalizeGuidepupClickOptions(options, "Guidepup VoiceOver"));
  }

  async itemText(): Promise<string> {
    return this.voiceOver.itemText();
  }

  async lastSpokenPhrase(): Promise<string> {
    return this.voiceOver.lastSpokenPhrase();
  }

  async itemTextLog(): Promise<string[]> {
    return this.voiceOver.itemTextLog();
  }

  async spokenPhraseLog(): Promise<string[]> {
    return this.voiceOver.spokenPhraseLog();
  }

  async clearItemTextLog(): Promise<void> {
    await this.voiceOver.clearItemTextLog();
  }

  async clearSpokenPhraseLog(): Promise<void> {
    await this.voiceOver.clearSpokenPhraseLog();
  }
}

class GuidepupNVDASession implements ScreenReaderSession {
  constructor(private readonly nvda: GuidepupNVDAApi) {}

  async start(options?: CommandOptions): Promise<void> {
    await this.nvda.start(options);
  }

  async stop(options?: CommandOptions): Promise<void> {
    await this.nvda.stop(options);
  }

  async next(options?: CommandOptions): Promise<void> {
    await this.nvda.next(options);
  }

  async previous(options?: CommandOptions): Promise<void> {
    await this.nvda.previous(options);
  }

  async act(options?: CommandOptions): Promise<void> {
    await this.nvda.act(options);
  }

  async interact(options?: CommandOptions): Promise<void> {
    await this.nvda.interact(options);
  }

  async stopInteracting(options?: CommandOptions): Promise<void> {
    await this.nvda.stopInteracting(options);
  }

  async perform(command: unknown, options?: CommandOptions): Promise<void> {
    await this.nvda.perform(
      resolveGuidepupPerformPayload(command, {
        resolveCatalog: (id) => resolveGuidepupNvdaPerformCommand(id, this.nvda.keyboardCommands),
        backendLabel: "Guidepup NVDA",
        supportsRawPerform: true
      }),
      options
    );
  }

  async press(key: string, options?: KeyboardOptions): Promise<void> {
    await this.nvda.press(key, options);
  }

  async type(text: string, options?: KeyboardOptions): Promise<void> {
    await this.nvda.type(text, options);
  }

  async click(options?: ClickOptions): Promise<void> {
    await this.nvda.click(normalizeGuidepupClickOptions(options, "Guidepup NVDA"));
  }

  async itemText(): Promise<string> {
    return this.nvda.itemText();
  }

  async lastSpokenPhrase(): Promise<string> {
    return this.nvda.lastSpokenPhrase();
  }

  async itemTextLog(): Promise<string[]> {
    return this.nvda.itemTextLog();
  }

  async spokenPhraseLog(): Promise<string[]> {
    return this.nvda.spokenPhraseLog();
  }

  async clearItemTextLog(): Promise<void> {
    await this.nvda.clearItemTextLog();
  }

  async clearSpokenPhraseLog(): Promise<void> {
    await this.nvda.clearSpokenPhraseLog();
  }
}

class GuidepupVirtualSession implements ScreenReaderSession {
  constructor(private readonly page: Page) {}

  async start(options?: CommandOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "start", options);
  }

  async stop(options?: CommandOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "stop", options);
  }

  async next(options?: CommandOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "next", options);
  }

  async previous(options?: CommandOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "previous", options);
  }

  async act(options?: CommandOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "act", options);
  }

  async interact(options?: CommandOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "interact", options);
  }

  async stopInteracting(options?: CommandOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "stopInteracting", options);
  }

  async perform(command: unknown): Promise<void> {
    const action = normalizePerformAction(command, "Guidepup virtual screen reader");
    await callGuidepupVirtualAdapter(this.page, "perform", action);
  }

  async press(key: string, options?: KeyboardOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "press", { key, options });
  }

  async type(text: string, options?: KeyboardOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "type", { text, options });
  }

  async click(options?: ClickOptions): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "click", options);
  }

  async itemText(): Promise<string> {
    return callGuidepupVirtualAdapter<string>(this.page, "itemText");
  }

  async lastSpokenPhrase(): Promise<string> {
    return callGuidepupVirtualAdapter<string>(this.page, "lastSpokenPhrase");
  }

  async itemTextLog(): Promise<string[]> {
    return callGuidepupVirtualAdapter<string[]>(this.page, "itemTextLog");
  }

  async spokenPhraseLog(): Promise<string[]> {
    return callGuidepupVirtualAdapter<string[]>(this.page, "spokenPhraseLog");
  }

  async clearItemTextLog(): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "clearItemTextLog");
  }

  async clearSpokenPhraseLog(): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "clearSpokenPhraseLog");
  }
}

async function callGuidepupVirtualAdapter<TResult>(
  page: Page,
  method: keyof GuidepupVirtualAdapter,
  argument?: unknown
): Promise<TResult> {
  await ensureGuidepupVirtualAdapter(page);

  return page.evaluate(
    async ({ globalKey, methodName, argumentValue }) => {
      const adapter = (globalThis as Record<string, unknown>)[globalKey];
      if (!adapter || typeof adapter !== "object") {
        throw new Error("Guidepup virtual screen reader adapter is not available in the page context.");
      }

      const candidate = (adapter as Record<string, unknown>)[methodName];
      if (typeof candidate !== "function") {
        throw new Error(`Guidepup virtual screen reader adapter is missing method "${methodName}".`);
      }

      const handler = candidate as (argument?: unknown) => Promise<TResult>;
      return argumentValue === undefined
        ? handler.call(adapter)
        : handler.call(adapter, argumentValue);
    },
    {
      globalKey: GUIDEPUP_VIRTUAL_ADAPTER_GLOBAL,
      methodName: method,
      argumentValue: argument
    }
  );
}

async function ensureGuidepupVirtualAdapter(page: Page): Promise<void> {
  const alreadyInstalled = await isGuidepupVirtualAdapterInstalled(page);
  if (alreadyInstalled) {
    return;
  }

  await page.addScriptTag({
    type: "module",
    content: await loadGuidepupVirtualAdapterScript()
  });

  const installed = await waitForGuidepupVirtualAdapter(page);
  if (!installed) {
    throw new Error("Failed to load Guidepup virtual screen reader into the page.");
  }
}

async function isGuidepupVirtualAdapterInstalled(page: Page): Promise<boolean> {
  return page
    .evaluate((globalKey) => Boolean((globalThis as Record<string, unknown>)[globalKey]), GUIDEPUP_VIRTUAL_ADAPTER_GLOBAL)
    .catch(() => false);
}

async function waitForGuidepupVirtualAdapter(page: Page): Promise<boolean> {
  const deadline = Date.now() + GUIDEPUP_VIRTUAL_ADAPTER_INSTALL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isGuidepupVirtualAdapterInstalled(page)) {
      return true;
    }

    await delay(GUIDEPUP_VIRTUAL_ADAPTER_INSTALL_POLL_MS);
  }

  return isGuidepupVirtualAdapterInstalled(page);
}

async function loadGuidepupVirtualAdapterScript(): Promise<string> {
  if (!guidepupVirtualAdapterScriptPromise) {
    guidepupVirtualAdapterScriptPromise = readFile(GUIDEPUP_VIRTUAL_BROWSER_BUNDLE_PATH, "utf8")
      .then((bundle) => {
        const encodedBundle = Buffer.from(bundle, "utf8").toString("base64");

        return `
const rawstepGuidepupVirtualBundleSource = atob(${JSON.stringify(encodedBundle)});
const rawstepGuidepupVirtualBundleUrl = URL.createObjectURL(
  new Blob([rawstepGuidepupVirtualBundleSource], { type: "text/javascript" })
);
const { virtual } = await import(rawstepGuidepupVirtualBundleUrl);
URL.revokeObjectURL(rawstepGuidepupVirtualBundleUrl);

const rawstepGuidepupVirtualAdapterKey = ${JSON.stringify(GUIDEPUP_VIRTUAL_ADAPTER_GLOBAL)};

if (!globalThis[rawstepGuidepupVirtualAdapterKey]) {
  const getContainer = () => document.body ?? document.documentElement;
  const ensureContainer = () => {
    const container = getContainer();
    if (!container) {
      throw new Error("Guidepup virtual screen reader requires document.body or document.documentElement.");
    }

    return container;
  };
  const ensureStarted = async (state) => {
    if (state.started) {
      return;
    }

    await virtual.start({
      container: ensureContainer(),
      window
    });
    state.started = true;
  };
  const state = {
    started: false
  };

  globalThis[rawstepGuidepupVirtualAdapterKey] = {
    async start(options) {
      if (state.started) {
        await virtual.stop();
      }

      await virtual.start({
        container: ensureContainer(),
        window,
        ...(options ?? {})
      });
      state.started = true;
    },
    async stop() {
      if (!state.started) {
        return;
      }

      await virtual.stop();
      state.started = false;
    },
    async next(options) {
      await ensureStarted(state);
      await virtual.next(options);
    },
    async previous(options) {
      await ensureStarted(state);
      await virtual.previous(options);
    },
    async act(options) {
      await ensureStarted(state);
      await virtual.act(options);
    },
    async interact(options) {
      await ensureStarted(state);
      await virtual.interact(options);
    },
    async stopInteracting(options) {
      await ensureStarted(state);
      await virtual.stopInteracting(options);
    },
    async perform(action) {
      await ensureStarted(state);
      if (!action || action.kind !== "invoke" || action.method !== "perform") {
        throw new Error("Guidepup virtual perform requires an invoke.perform action.");
      }

      if (action.command.source !== "catalog") {
        throw new Error("Guidepup virtual screen reader only supports catalog perform commands.");
      }

      const propertyName = action.command.id.startsWith("commands.")
        ? action.command.id.slice("commands.".length)
        : "";
      const command = virtual.commands[propertyName];
      if (command === undefined) {
        throw new Error(\`Guidepup virtual screen reader does not support perform id "\${action.command.id}".\`);
      }

      await virtual.perform(command, action.command.args ?? action.options);
    },
    async press(input) {
      await ensureStarted(state);
      await virtual.press(input.key, input.options);
    },
    async type(input) {
      await ensureStarted(state);
      await virtual.type(input.text, input.options);
    },
    async click(options) {
      await ensureStarted(state);
      await virtual.click(options);
    },
    async itemText() {
      await ensureStarted(state);
      return virtual.itemText();
    },
    async lastSpokenPhrase() {
      await ensureStarted(state);
      return virtual.lastSpokenPhrase();
    },
    async itemTextLog() {
      await ensureStarted(state);
      return virtual.itemTextLog();
    },
    async spokenPhraseLog() {
      await ensureStarted(state);
      return virtual.spokenPhraseLog();
    },
    async clearItemTextLog() {
      await ensureStarted(state);
      await virtual.clearItemTextLog();
    },
    async clearSpokenPhraseLog() {
      await ensureStarted(state);
      await virtual.clearSpokenPhraseLog();
    }
  };
}
`;
      });
  }

  return guidepupVirtualAdapterScriptPromise;
}

function normalizeGuidepupClickOptions(
  options: ClickOptions | undefined,
  backendLabel: string
): GuidepupClickOptions | undefined {
  if (options?.clickCount !== undefined && (options.clickCount < 1 || options.clickCount > 3)) {
    throw new Error(`${backendLabel} clickCount must be between 1 and 3.`);
  }

  if (options?.button === undefined && options?.clickCount === undefined) {
    return undefined;
  }

  return {
    button: options?.button,
    clickCount: options?.clickCount as 1 | 2 | 3 | undefined
  };
}

function resolveGuidepupPerformPayload(
  command: unknown,
  options: {
    resolveCatalog: (id: string) => unknown;
    backendLabel: string;
    supportsRawPerform: boolean;
  }
): unknown {
  const normalized = normalizePerformAction(command, options.backendLabel);

  if (normalized.command.source === "raw") {
    if (!options.supportsRawPerform) {
      throw new Error(`${options.backendLabel} does not support raw perform payloads.`);
    }

    return normalized.command.payload;
  }

  const resolved = options.resolveCatalog(normalized.command.id);
  if (resolved === undefined) {
    throw new Error(`${options.backendLabel} does not support perform id "${normalized.command.id}".`);
  }

  return resolved;
}

function normalizePerformAction(
  command: unknown,
  backendLabel: string
): Extract<ScreenReaderAction, { kind: "invoke"; method: "perform" }> {
  if (
    typeof command === "object"
    && command !== null
    && "source" in command
    && (command as { source?: unknown }).source === "catalog"
    && typeof (command as { id?: unknown }).id === "string"
  ) {
    const candidate = command as {
      source: "catalog";
      id: string;
      args?: unknown;
    };
    return {
      kind: "invoke",
      method: "perform",
      command: {
        source: "catalog",
        id: candidate.id,
        ...(typeof candidate.args === "object" && candidate.args !== null
          ? { args: candidate.args as Record<string, unknown> }
          : {})
      }
    };
  }

  if (
    typeof command === "object"
    && command !== null
    && "source" in command
    && (command as { source?: unknown }).source === "raw"
    && typeof (command as { payload?: unknown }).payload === "object"
    && (command as { payload?: unknown }).payload !== null
  ) {
    const candidate = command as {
      source: "raw";
      payload: Record<string, unknown>;
    };
    return {
      kind: "invoke",
      method: "perform",
      command: {
        source: "raw",
        payload: candidate.payload
      }
    };
  }

  throw new Error(`${backendLabel} received an invalid perform command payload.`);
}
