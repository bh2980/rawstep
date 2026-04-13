import type { Page } from "playwright";
import { SCREENREADER_COMMANDS, type ScreenReaderCommand } from "@a11y-task/core";
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

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled screen reader command: ${String(value)}`);
}

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

export const guidepupVirtualBackend: ScreenReaderBackend = {
  id: "guidepup-virtual",
  supportedCommands: SCREENREADER_COMMANDS,
  supports() {
    return true;
  },
  async createSession(): Promise<ScreenReaderSession> {
    throw new Error(
      'Screen reader backend "guidepup-virtual" is not implemented yet.'
    );
  }
};
