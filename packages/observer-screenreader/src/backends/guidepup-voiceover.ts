import type { ScreenReaderCommand } from "@a11y-task/core";
import type { Page } from "playwright";
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
