import type { ScreenReaderController } from "@a11y-task/actuator";
import type { ScreenReaderCommand, ScreenReaderObservation } from "@a11y-task/core";
import type { Page } from "playwright";

type VoiceOverApi = {
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
  voiceOver: VoiceOverApi;
};

export type ScreenReaderRuntime = {
  observer: ScreenReaderObserver;
  controller: ScreenReaderController;
  close(): Promise<void>;
};

export type ScreenReaderRuntimeFactory = (page: Page) => Promise<ScreenReaderRuntime>;

export type VoiceOverRuntimeDependencies = {
  importGuidepup?: () => Promise<GuidepupModule>;
};

export class ScreenReaderObserver {
  private previousAnnouncement?: string;

  constructor(private readonly readAnnouncement: () => Promise<string>) {}

  async observe(): Promise<ScreenReaderObservation> {
    const announcement = await this.readAnnouncement();
    const observation: ScreenReaderObservation = {
      kind: "screenreader",
      announcement
    };

    if (this.previousAnnouncement !== undefined) {
      observation.previousAnnouncement = this.previousAnnouncement;
    }

    this.previousAnnouncement = announcement;
    return observation;
  }
}

export async function createVoiceOverRuntime(
  page: Page,
  dependencies: VoiceOverRuntimeDependencies = {}
): Promise<ScreenReaderRuntime> {
  if (process.platform !== "darwin") {
    throw new Error("screenreader mode currently supports only macOS VoiceOver.");
  }

  const importGuidepup = dependencies.importGuidepup
    ?? (async () => import("@guidepup/guidepup") as unknown as Promise<GuidepupModule>);

  const { voiceOver } = await importGuidepup();

  try {
    await page.bringToFront();
    await focusPageRoot(page);
    await voiceOver.start();
    await focusPageRoot(page);
  } catch (error) {
    throw new Error(
      `Failed to start VoiceOver for screenreader mode. Ensure VoiceOver is available and accessibility permissions are granted. ${getErrorMessage(error)}`
    );
  }

  const readAnnouncement = createAnnouncementReader(voiceOver);

  return {
    observer: new ScreenReaderObserver(readAnnouncement),
    controller: new VoiceOverCommandController(voiceOver),
    close: async () => {
      try {
        await voiceOver.stop();
      } catch {
        // Best effort cleanup only.
      }

      await cleanupBootstrapFocus(page);
    }
  };
}

export function createAnnouncementReader(voiceOver: Pick<
  VoiceOverApi,
  "lastSpokenPhrase" | "spokenPhraseLog" | "clearSpokenPhraseLog"
>): () => Promise<string> {
  let firstObservation = true;

  return async () => {
    const log = await voiceOver.spokenPhraseLog();
    const phrases = log
      .map((phrase) => phrase.trim())
      .filter(Boolean);

    await voiceOver.clearSpokenPhraseLog();

    if (phrases.length > 0) {
      firstObservation = false;
      return phrases.join("\n");
    }

    if (firstObservation) {
      firstObservation = false;
      return (await voiceOver.lastSpokenPhrase()).trim();
    }

    return "";
  };
}

class VoiceOverCommandController implements ScreenReaderController {
  constructor(private readonly voiceOver: VoiceOverApi) {}

  async execute(command: ScreenReaderCommand): Promise<void> {
    switch (command) {
      case "nextItem":
        await this.voiceOver.next();
        return;
      case "previousItem":
        await this.voiceOver.previous();
        return;
      case "nextFormControl":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findNextControl);
        return;
      case "previousFormControl":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findPreviousControl);
        return;
      case "nextHeading":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findNextHeading);
        return;
      case "previousHeading":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findPreviousHeading);
        return;
      case "act":
        await this.voiceOver.act();
        return;
      default:
        assertUnreachable(command);
    }
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled screen reader command: ${String(value)}`);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function focusPageRoot(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.body ?? document.documentElement;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
      target.setAttribute("data-a11y-bootstrap-tabindex", "true");
    }

    target.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
}

async function cleanupBootstrapFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector("[data-a11y-bootstrap-tabindex='true']");
    if (!(target instanceof HTMLElement)) {
      return;
    }

    target.removeAttribute("tabindex");
    target.removeAttribute("data-a11y-bootstrap-tabindex");
  });
}
