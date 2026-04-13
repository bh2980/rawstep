import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";
import {
  SCREENREADER_COMMANDS,
  SCREENREADER_COMMAND_METADATA,
  type ScreenReaderCommand
} from "@a11y-task/core";
import type { ScreenReaderBackend, ScreenReaderSession } from "../types";

type GuidepupVoiceOverApi = {
  start(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  act(): Promise<void>;
  perform(command: unknown): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  keyboardCommands: {
    findNextHeading: unknown;
    findPreviousHeading: unknown;
    findNextControl: unknown;
    findPreviousControl: unknown;
  };
};

type GuidepupModule = {
  voiceOver: GuidepupVoiceOverApi;
};

type GuidepupNVDAApi = {
  start(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  act(): Promise<void>;
  perform(command: unknown): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  keyboardCommands: {
    moveToNextHeading: unknown;
    moveToPreviousHeading: unknown;
    moveToNextFormField: unknown;
    moveToPreviousFormField: unknown;
  };
};

type GuidepupNVDACompatibleModule = {
  nvda: GuidepupNVDAApi;
};

type GuidepupVirtualAdapter = {
  start(): Promise<void>;
  stop(): Promise<void>;
  execute(command: ScreenReaderCommand): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
};

const GUIDEPUP_VIRTUAL_ADAPTER_GLOBAL = "__rawstepGuidepupVirtualAdapter";
const requireFromHere = createRequire(__filename);
const GUIDEPUP_VIRTUAL_BROWSER_BUNDLE_PATH = requireFromHere.resolve("@guidepup/virtual-screen-reader/browser.js");
const GUIDEPUP_VIRTUAL_SUPPORTED_COMMANDS = SCREENREADER_COMMANDS.filter(
  (command) => SCREENREADER_COMMAND_METADATA[command].category !== "form"
) as readonly ScreenReaderCommand[];
const GUIDEPUP_VIRTUAL_ADAPTER_INSTALL_TIMEOUT_MS = 1_000;
const GUIDEPUP_VIRTUAL_ADAPTER_INSTALL_POLL_MS = 10;

let guidepupVirtualAdapterScriptPromise: Promise<string> | undefined;

export const guidepupVoiceOverBackend: ScreenReaderBackend = {
  id: "guidepup-voiceover",
  supportedCommands: SCREENREADER_COMMANDS,
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
  supportedCommands: SCREENREADER_COMMANDS,
  supports(platform) {
    return platform === "win32";
  },
  async createSession(_page: Page): Promise<ScreenReaderSession> {
    const { nvda } = await import("@guidepup/guidepup") as unknown as GuidepupNVDACompatibleModule;
    return new GuidepupNVDASession(nvda);
  }
};

export const guidepupVirtualBackend: ScreenReaderBackend = {
  id: "guidepup-virtual",
  supportedCommands: GUIDEPUP_VIRTUAL_SUPPORTED_COMMANDS,
  supports() {
    return true;
  },
  async createSession(page: Page): Promise<ScreenReaderSession> {
    return new GuidepupVirtualSession(page);
  }
};

class GuidepupVoiceOverSession implements ScreenReaderSession {
  constructor(private readonly voiceOver: GuidepupVoiceOverApi) {}

  async start(): Promise<void> {
    await this.voiceOver.start();
  }

  async stop(): Promise<void> {
    await this.voiceOver.stop();
  }

  async execute(command: ScreenReaderCommand): Promise<void> {
    switch (command) {
      case "nextItem":
        await this.voiceOver.next();
        return;
      case "previousItem":
        await this.voiceOver.previous();
        return;
      case "nextHeading":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findNextHeading);
        return;
      case "previousHeading":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findPreviousHeading);
        return;
      case "nextFormControl":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findNextControl);
        return;
      case "previousFormControl":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findPreviousControl);
        return;
      case "act":
        await this.voiceOver.act();
        return;
      default:
        assertUnreachable(command);
    }
  }

  async lastSpokenPhrase(): Promise<string> {
    return this.voiceOver.lastSpokenPhrase();
  }

  async spokenPhraseLog(): Promise<string[]> {
    return this.voiceOver.spokenPhraseLog();
  }

  async clearSpokenPhraseLog(): Promise<void> {
    await this.voiceOver.clearSpokenPhraseLog();
  }
}

class GuidepupNVDASession implements ScreenReaderSession {
  constructor(private readonly nvda: GuidepupNVDAApi) {}

  async start(): Promise<void> {
    await this.nvda.start();
  }

  async stop(): Promise<void> {
    await this.nvda.stop();
  }

  async execute(command: ScreenReaderCommand): Promise<void> {
    switch (command) {
      case "nextItem":
        await this.nvda.next();
        return;
      case "previousItem":
        await this.nvda.previous();
        return;
      case "nextHeading":
        await this.nvda.perform(this.nvda.keyboardCommands.moveToNextHeading);
        return;
      case "previousHeading":
        await this.nvda.perform(this.nvda.keyboardCommands.moveToPreviousHeading);
        return;
      case "nextFormControl":
        await this.nvda.perform(this.nvda.keyboardCommands.moveToNextFormField);
        return;
      case "previousFormControl":
        await this.nvda.perform(this.nvda.keyboardCommands.moveToPreviousFormField);
        return;
      case "act":
        await this.nvda.act();
        return;
      default:
        assertUnreachable(command);
    }
  }

  async lastSpokenPhrase(): Promise<string> {
    return this.nvda.lastSpokenPhrase();
  }

  async spokenPhraseLog(): Promise<string[]> {
    return this.nvda.spokenPhraseLog();
  }

  async clearSpokenPhraseLog(): Promise<void> {
    await this.nvda.clearSpokenPhraseLog();
  }
}

class GuidepupVirtualSession implements ScreenReaderSession {
  constructor(private readonly page: Page) {}

  async start(): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "start");
  }

  async stop(): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "stop");
  }

  async execute(command: ScreenReaderCommand): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "execute", command);
  }

  async lastSpokenPhrase(): Promise<string> {
    return callGuidepupVirtualAdapter<string>(this.page, "lastSpokenPhrase");
  }

  async spokenPhraseLog(): Promise<string[]> {
    return callGuidepupVirtualAdapter<string[]>(this.page, "spokenPhraseLog");
  }

  async clearSpokenPhraseLog(): Promise<void> {
    await callGuidepupVirtualAdapter(this.page, "clearSpokenPhraseLog");
  }
}

async function callGuidepupVirtualAdapter<TResult>(
  page: Page,
  method: keyof GuidepupVirtualAdapter,
  command?: ScreenReaderCommand
): Promise<TResult> {
  await ensureGuidepupVirtualAdapter(page);

  return page.evaluate(
    async ({ globalKey, methodName, commandName }) => {
      const adapter = (globalThis as Record<string, unknown>)[globalKey];
      if (!adapter || typeof adapter !== "object") {
        throw new Error('Guidepup virtual screen reader adapter is not available in the page context.');
      }

      const candidate = (adapter as Record<string, unknown>)[methodName];
      if (typeof candidate !== "function") {
        throw new Error(`Guidepup virtual screen reader adapter is missing method "${methodName}".`);
      }

      const handler = candidate as (argument?: string) => Promise<TResult>;
      return commandName === undefined
        ? handler.call(adapter)
        : handler.call(adapter, commandName);
    },
    {
      globalKey: GUIDEPUP_VIRTUAL_ADAPTER_GLOBAL,
      methodName: method,
      commandName: command
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

  // Module scripts that do dynamic imports can finish a tick after addScriptTag resolves.
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
    async start() {
      if (state.started) {
        await virtual.stop();
      }

      await virtual.start({
        container: ensureContainer(),
        window
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
    async execute(command) {
      await ensureStarted(state);

      switch (command) {
        case "nextItem":
          await virtual.next();
          return;
        case "previousItem":
          await virtual.previous();
          return;
        case "nextHeading":
          await virtual.perform(virtual.commands.moveToNextHeading);
          return;
        case "previousHeading":
          await virtual.perform(virtual.commands.moveToPreviousHeading);
          return;
        case "act":
          await virtual.act();
          return;
        default:
          throw new Error(\`Guidepup virtual screen reader does not support command "\${command}".\`);
      }
    },
    async lastSpokenPhrase() {
      await ensureStarted(state);
      return virtual.lastSpokenPhrase();
    },
    async spokenPhraseLog() {
      await ensureStarted(state);
      return virtual.spokenPhraseLog();
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

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled screen reader command: ${String(value)}`);
}
