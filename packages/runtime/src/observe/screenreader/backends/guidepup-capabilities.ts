import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { ScreenReaderCapabilities, ScreenReaderPerformCommand } from "@rawstep/action-catalog";

const requireFromHere = createRequire(__filename);
const guidepupPackageRoot = dirname(requireFromHere.resolve("@guidepup/guidepup/package.json"));

type CommandRecord = Record<string, {
  description?: string;
  representation?: string;
}>;

type CommanderCommandRecord = Record<string, string>;

type VirtualModuleShape = {
  virtual: {
    commands: Record<string, unknown>;
    next?: unknown;
    previous?: unknown;
    act?: unknown;
    perform?: unknown;
    press?: unknown;
    type?: unknown;
    interact?: unknown;
    stopInteracting?: unknown;
    click?: unknown;
    itemText?: unknown;
    itemTextLog?: unknown;
    lastSpokenPhrase?: unknown;
    spokenPhraseLog?: unknown;
    clearItemTextLog?: unknown;
    clearSpokenPhraseLog?: unknown;
  };
};

const voiceOverKeyCodeCommands = requireFromHere(
  join(guidepupPackageRoot, "lib/macOS/VoiceOver/keyCodeCommands.js")
).keyCodeCommands as CommandRecord;

const nvdaKeyCodeCommands = requireFromHere(
  join(guidepupPackageRoot, "lib/windows/NVDA/keyCodeCommands.js")
).keyCodeCommands as CommandRecord;

const voiceOverCommanderCommands = requireFromHere(
  join(guidepupPackageRoot, "lib/macOS/VoiceOver/CommanderCommands.js")
).CommanderCommands as CommanderCommandRecord;

const { virtual } = requireFromHere("@guidepup/virtual-screen-reader") as VirtualModuleShape;

const VIRTUAL_INDEX_ARG_HINT = 'args: {"index": number}';

const voiceOverPerformCommands = [
  ...createKeyboardPerformCommands(voiceOverKeyCodeCommands),
  ...createCommanderPerformCommands(voiceOverCommanderCommands)
] as const satisfies readonly ScreenReaderPerformCommand[];

const nvdaPerformCommands = createKeyboardPerformCommands(nvdaKeyCodeCommands);
const virtualPerformCommands = createVirtualPerformCommands(virtual.commands);

const guidepupVoiceOverCapabilities: ScreenReaderCapabilities = {
  invoke: {
    next: true,
    previous: true,
    act: true,
    interact: true,
    stopInteracting: true,
    press: true,
    type: true,
    click: true,
    perform: true,
    supportsRawPerform: true
  },
  read: {
    itemText: true,
    itemTextLog: true,
    lastSpokenPhrase: true,
    spokenPhraseLog: true
  },
  maintenance: {
    clearItemTextLog: true,
    clearSpokenPhraseLog: true
  },
  performCatalog: voiceOverPerformCommands
};

const guidepupNvdaCapabilities: ScreenReaderCapabilities = {
  invoke: {
    next: true,
    previous: true,
    act: true,
    interact: true,
    stopInteracting: true,
    press: true,
    type: true,
    click: true,
    perform: true,
    supportsRawPerform: true
  },
  read: {
    itemText: true,
    itemTextLog: true,
    lastSpokenPhrase: true,
    spokenPhraseLog: true
  },
  maintenance: {
    clearItemTextLog: true,
    clearSpokenPhraseLog: true
  },
  performCatalog: nvdaPerformCommands
};

const guidepupVirtualCapabilities: ScreenReaderCapabilities = {
  invoke: {
    next: typeof virtual.next === "function",
    previous: typeof virtual.previous === "function",
    act: typeof virtual.act === "function",
    interact: typeof virtual.interact === "function",
    stopInteracting: typeof virtual.stopInteracting === "function",
    press: typeof virtual.press === "function",
    type: typeof virtual.type === "function",
    click: typeof virtual.click === "function",
    perform: typeof virtual.perform === "function",
    supportsRawPerform: false
  },
  read: {
    itemText: typeof virtual.itemText === "function",
    itemTextLog: typeof virtual.itemTextLog === "function",
    lastSpokenPhrase: typeof virtual.lastSpokenPhrase === "function",
    spokenPhraseLog: typeof virtual.spokenPhraseLog === "function"
  },
  maintenance: {
    clearItemTextLog: typeof virtual.clearItemTextLog === "function",
    clearSpokenPhraseLog: typeof virtual.clearSpokenPhraseLog === "function"
  },
  performCatalog: virtualPerformCommands
};

export function getGuidepupVoiceOverCapabilities(): ScreenReaderCapabilities {
  return guidepupVoiceOverCapabilities;
}

export function getGuidepupNvdaCapabilities(): ScreenReaderCapabilities {
  return guidepupNvdaCapabilities;
}

export function getGuidepupVirtualCapabilities(): ScreenReaderCapabilities {
  return guidepupVirtualCapabilities;
}

export function resolveGuidepupVoiceOverPerformCommand(
  id: string,
  keyboardCommands: Record<string, unknown>
): unknown {
  if (id.startsWith("keyboard.")) {
    return keyboardCommands[id.slice("keyboard.".length)];
  }

  if (id.startsWith("commander.")) {
    return voiceOverCommanderCommands[id.slice("commander.".length)];
  }

  return undefined;
}

export function resolveGuidepupNvdaPerformCommand(
  id: string,
  keyboardCommands: Record<string, unknown>
): unknown {
  if (!id.startsWith("keyboard.")) {
    return undefined;
  }

  return keyboardCommands[id.slice("keyboard.".length)];
}

export function resolveGuidepupVirtualPerformCommand(
  id: string,
  commands: Record<string, unknown>
): unknown {
  if (!id.startsWith("commands.")) {
    return undefined;
  }

  return commands[id.slice("commands.".length)];
}

function createKeyboardPerformCommands(commandMap: CommandRecord): ScreenReaderPerformCommand[] {
  return Object.entries(commandMap).map(([propertyName, metadata]) => ({
    id: `keyboard.${propertyName}`,
    label: metadata.representation?.trim() || propertyName,
    description: metadata.description?.trim() || humanizePropertyName(propertyName)
  }));
}

function createCommanderPerformCommands(commandMap: CommanderCommandRecord): ScreenReaderPerformCommand[] {
  return Object.entries(commandMap).map(([enumKey, value]) => ({
    id: `commander.${enumKey}`,
    label: value,
    description: humanizeEnumKey(enumKey)
  }));
}

function createVirtualPerformCommands(commands: Record<string, unknown>): ScreenReaderPerformCommand[] {
  return Object.keys(commands).map((propertyName) => ({
    id: `commands.${propertyName}`,
    label: propertyName,
    description: humanizePropertyName(propertyName),
    ...(getVirtualArgsHint(propertyName) ? { argsHint: getVirtualArgsHint(propertyName) } : {})
  }));
}

function humanizePropertyName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim();
}

function humanizeEnumKey(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .trim();
}

function getVirtualArgsHint(propertyName: string): string | undefined {
  return new Set([
    "jumpToControlledElement",
    "jumpToErrorMessageElement",
    "moveToNextAlternateReadingOrderElement",
    "moveToPreviousAlternateReadingOrderElement"
  ]).has(propertyName)
    ? VIRTUAL_INDEX_ARG_HINT
    : undefined;
}
