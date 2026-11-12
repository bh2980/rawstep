import { BACKEND_KEYS, type KnownIntent } from "@rawstep/core/actions";
import type { BackendAction, BackendCapabilities } from "@rawstep/core/contracts";
import { AtDriverError } from "./transport.js";
import { macClipboard, voiceoverCommander, voiceoverCursorLocator, type ClipboardWriter, type CursorLocator, type ReaderCommander } from "./voiceover-applescript.js";

export type AtDriverProfileName = "voiceover" | "nvda";
/** The backend contract's own action and capabilities: the names are kept for callers of this module. */
export type AtDriverAction = BackendAction;
export type AtDriverCapabilities = BackendCapabilities;

// WebDriver key code points, as used by AT Driver pressKeys.
export const AT_DRIVER_KEYS = Object.freeze({
  Backspace: "\uE003", Tab: "\uE004", Enter: "\uE006", Shift: "\uE008",
  Control: "\uE009", Alt: "\uE00A", Escape: "\uE00C", Space: "\uE00D",
  PageUp: "\uE00E", PageDown: "\uE00F", End: "\uE010", Home: "\uE011",
  ArrowLeft: "\uE012", ArrowUp: "\uE013", ArrowRight: "\uE014", ArrowDown: "\uE015",
  Delete: "\uE017", Semicolon: "\uE018", Equal: "\uE019", Meta: "\uE03D",
});

// The named keys are core's, shared with the simulation; how each one reaches the reader is `mapAction`'s.
const allowedKeys: readonly string[] = BACKEND_KEYS;
const vo = [AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt];
const voiceoverIntents: Readonly<Record<string, readonly string[]>> = Object.freeze({
  next: [...vo, AT_DRIVER_KEYS.ArrowRight],
  previous: [...vo, AT_DRIVER_KEYS.ArrowLeft],
  activate: [...vo, AT_DRIVER_KEYS.Space],
  interact: [...vo, AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.ArrowDown],
  stopInteracting: [...vo, AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.ArrowUp],
  "heading.next": [...vo, AT_DRIVER_KEYS.Meta, "h"],
  "form.next": [...vo, AT_DRIVER_KEYS.Meta, "j"],
  "link.next": [...vo, AT_DRIVER_KEYS.Meta, "l"],
} satisfies Partial<Record<KnownIntent, readonly string[]>>);
/**
 * VoiceOver's own commands, run through its AppleScript commander instead of keys. Bocoup's server sends VO+Command+Shift+H/J/L, but
 * VoiceOver's keyboard help names what arrives as Find Next Heading/Control/Link: the Shift is lost on the way. The same keys posted as
 * hardware events are named Find Previous, so the keys are right and the server's way of sending Shift is not.
 */
const voiceoverCommands: Readonly<Record<string, string>> = Object.freeze({
  "heading.previous": "find previous heading",
  "form.previous": "find previous control",
  "link.previous": "find previous link",
} satisfies Partial<Record<KnownIntent, string>>);
const nvdaIntents: Readonly<Record<string, readonly string[]>> = Object.freeze({
  next: [AT_DRIVER_KEYS.ArrowDown], // Browse-mode next line, not VoiceOver's next object.
  previous: [AT_DRIVER_KEYS.ArrowUp],
  activate: [AT_DRIVER_KEYS.Enter],
  "heading.next": ["h"],
  "heading.previous": [AT_DRIVER_KEYS.Shift, "h"],
  "form.next": ["f"],
  "form.previous": [AT_DRIVER_KEYS.Shift, "f"],
  "link.next": ["k"],
  "link.previous": [AT_DRIVER_KEYS.Shift, "k"],
} satisfies Partial<Record<KnownIntent, readonly string[]>>);

/** A rotor list found by ear: open the rotor, move to the next list until the wanted list's name is spoken, close it when done. */
export interface AtDriverRotorList {
  open: readonly string[];
  nextList: readonly string[];
  close: readonly string[];
  /** Spoken when the wanted list is shown (English or Korean speech). */
  listName: RegExp;
  /** The line naming the list's current item, which follows the list's name and can hold the wanted name as a word of its own. */
  itemLine: RegExp;
  maxLists: number;
}
/**
 * A screen reader list read by listening: open it, move to the wanted list until its name is spoken, read item by item until an item
 * comes round again or nothing new is said, then close it. Every word spoken along the way is kept as the action's speech.
 */
export interface AtDriverListRoutine extends AtDriverRotorList {
  nextItem: readonly string[];
  maxItems: number;
}
/**
 * A rotor list left open across actions: found like a list routine, then `next`/`previous` move through it, `activate` picks the item
 * (closing it), and any other action closes it first.
 */
export interface AtDriverRotorRoutine extends AtDriverRotorList {
  next: readonly string[];
  previous: readonly string[];
  pick: readonly string[];
}
/** VoiceOver's rotor (VO+U): Right/Left switch lists, Down/Up move through one, Return goes to the item, Escape closes it. */
const voiceoverRotor = { open: [...vo, "u"], nextList: [AT_DRIVER_KEYS.ArrowRight], close: [AT_DRIVER_KEYS.Escape], itemLine: /^on item\b/i, maxLists: 12 } as const;
const voiceoverRoutines: Readonly<Record<string, AtDriverListRoutine>> = Object.freeze({
  "headings.list": { ...voiceoverRotor, nextItem: [AT_DRIVER_KEYS.ArrowDown], listName: /\bheadings\b|머리말/i, maxItems: 100 },
  // Anchored: a heading or form control can have "links" or "링크" in its name.
  "links.list": { ...voiceoverRotor, nextItem: [AT_DRIVER_KEYS.ArrowDown], listName: /^(?:links|링크)(?![^\s,.])/i, maxItems: 300 },
} satisfies Partial<Record<KnownIntent, AtDriverListRoutine>>);
const voiceoverRotors: Readonly<Record<string, AtDriverRotorRoutine>> = Object.freeze({
  "formControls.rotor": { ...voiceoverRotor, next: [AT_DRIVER_KEYS.ArrowDown], previous: [AT_DRIVER_KEYS.ArrowUp], pick: [AT_DRIVER_KEYS.Enter], listName: /form controls|폼 컨트롤|양식 컨트롤/i },
} satisfies Partial<Record<KnownIntent, AtDriverRotorRoutine>>);
/**
 * How a reader whose cursor can stay on the browser's own controls when a page loads gets into the page: move until the cursor is on
 * the web content, then go in. Going in from anywhere else enters that item instead (on the tab group it lands on the tab's Close
 * button), so the cursor's place is checked before going in and after. The place is read from the screen, not from speech, so it
 * holds in any speech language (see `CursorLocator`).
 */
export interface AtDriverPageEntry {
  move: readonly string[];
  enter: readonly string[];
  maxMoves: number;
}
const voiceoverPageEntry: AtDriverPageEntry = Object.freeze({ move: voiceoverIntents.next!, enter: voiceoverIntents.interact!, maxMoves: 8 });

/**
 * What a reader needs of its host besides AT Driver keys: where its cursor is on the screen (to get into a page), its own commands,
 * and the clipboard. Each is a factory for the helper that works when the reader runs on this machine; a paired reader on another
 * machine has them passed to the backend instead.
 */
export interface AtDriverHostHelpers {
  cursorLocator(): CursorLocator;
  commander(): ReaderCommander;
  clipboard(): ClipboardWriter;
}
export interface AtDriverProfile {
  name: AtDriverProfileName;
  atName: string;
  platformName: string;
  /** The reader's operating system as Node names it (`process.platform`): the AT server, the reader and the browser share that host. */
  platform: NodeJS.Platform;
  /** Set for a reader whose page entry, commands or pasted text need the host (see `AtDriverHostHelpers`). */
  hostHelpers?: AtDriverHostHelpers;
  capabilities: AtDriverCapabilities;
  assumptions: readonly string[];
  sources: readonly string[];
  mapAction(action: AtDriverAction): string[][];
  /** Intents carried out by listening between key presses (see `AtDriverListRoutine`). */
  routines: Readonly<Record<string, AtDriverListRoutine>>;
  /** Intents that open a rotor list and leave it open (see `AtDriverRotorRoutine`). */
  rotors: Readonly<Record<string, AtDriverRotorRoutine>>;
  /** Intents carried out by the reader's own command of this name instead of keys (see `voiceoverCommands`). */
  commands: Readonly<Record<string, string>>;
  /** Set when the reader needs moving into a newly loaded page (see `AtDriverPageEntry`). */
  pageEntry?: AtDriverPageEntry;
  /**
   * The text a text action puts on the clipboard to paste, when the keys cannot type it (letters outside ASCII, such as Korean):
   * `mapAction` then presses paste instead of typing. Undefined for text the keys type, other actions, and readers that cannot paste.
   */
  pasteText(action: AtDriverAction): string | undefined;
}

const shiftedDigits: Readonly<Record<string, string>> = Object.freeze({
  "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
});
const macPunctuation: Readonly<Record<string, string>> = Object.freeze({
  "-": "minus", "[": "squareLeft", "]": "squareRight", "'": "quote", "\\": "backslash",
  ",": "comma", "/": "slash", ".": "period", "`": "backtick",
});
const shiftedPunctuation: Readonly<Record<string, string>> = Object.freeze({
  "_": "-", "{": "[", "}": "]", '"': "'", "|": "\\", "<": ",", ">": ".", "?": "/", "~": "`",
});

/** What differs between the readers' key profiles, as data: the factory below reads it and never asks which reader it is. */
type ProfileSpec = {
  atName: string; platformName: string; platform: NodeJS.Platform;
  intents: Readonly<Record<string, readonly string[]>>;
  routines: Readonly<Record<string, AtDriverListRoutine>>; rotors: Readonly<Record<string, AtDriverRotorRoutine>>; commands: Readonly<Record<string, string>>;
  pageEntry?: AtDriverPageEntry; hostHelpers?: AtDriverHostHelpers;
  /** The modifier of select-all and paste: Command on macOS, Control on Windows. */
  commandKey: string;
  /** Whether the AT Driver server takes the named punctuation keys (Bocoup's macOS server does; the PAC NVDA server does not). */
  punctuationKeys: boolean;
  /** Whether text the keys cannot type is pasted from the clipboard instead (needs `hostHelpers`). */
  pastesText: boolean;
  assumptions: readonly string[]; sources: readonly string[];
};

function typeable(text: string, spec: Pick<ProfileSpec, "atName" | "punctuationKeys">): boolean {
  try { textKeys(text, spec); return true; } catch { return false; }
}

function textKeys(text: string, spec: Pick<ProfileSpec, "atName" | "punctuationKeys">): string[][] {
  // Validate the complete text before returning ANY key presses, particularly a destructive replace.
  // No DOM fallback, hidden focus repair, extension intent, or synthesized speech. Text these keys cannot type is not typed here at
  // all: a profile that pastes (`pastesText`) puts it on the clipboard, any other refuses the action.
  return Array.from(text, character => {
    if (/^[a-z0-9]$/.test(character)) return [character];
    if (/^[A-Z]$/.test(character)) return [AT_DRIVER_KEYS.Shift, character.toLowerCase()];
    if (character === " ") return [AT_DRIVER_KEYS.Space];
    if (Object.hasOwn(shiftedDigits, character)) return [AT_DRIVER_KEYS.Shift, shiftedDigits[character]!];
    if (character === ";" || character === ":") return character === ";" ? [AT_DRIVER_KEYS.Semicolon] : [AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.Semicolon];
    if (character === "=" || character === "+") return character === "=" ? [AT_DRIVER_KEYS.Equal] : [AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.Equal];
    // Bocoup's macOS server explicitly supports these key names. The PAC NVDA
    // server only accepts alphanumeric characters and its enumerated key codes.
    if (spec.punctuationKeys) {
      if (Object.hasOwn(macPunctuation, character)) return [macPunctuation[character]!];
      if (Object.hasOwn(shiftedPunctuation, character)) return [AT_DRIVER_KEYS.Shift, macPunctuation[shiftedPunctuation[character]!]!];
    }
    throw new AtDriverError(`Text contains a character unsupported by the ${spec.atName.toLowerCase()} key profile (U+${character.codePointAt(0)!.toString(16).toUpperCase()})`, "unsupported action");
  });
}

const KEYBOARD_ASSUMPTION = "US keyboard layout and default key bindings; actual layout and bindings are unknown";
const PROFILE_SPECS: Readonly<Record<AtDriverProfileName, ProfileSpec>> = Object.freeze({
  voiceover: {
    atName: "VoiceOver", platformName: "macos", platform: "darwin",
    intents: voiceoverIntents, routines: voiceoverRoutines, rotors: voiceoverRotors, commands: voiceoverCommands, pageEntry: voiceoverPageEntry,
    // VoiceOver's cursor place and commands go through AppleScript, and pasted text through pbcopy: all on the Mac the reader is on.
    hostHelpers: { cursorLocator: () => voiceoverCursorLocator(), commander: () => voiceoverCommander(), clipboard: () => macClipboard() },
    commandKey: AT_DRIVER_KEYS.Meta, punctuationKeys: true, pastesText: true,
    assumptions: [KEYBOARD_ASSUMPTION, "VoiceOver modifier is Control+Option", "Printable ASCII text is typed key by key; punctuation uses Bocoup macOS server key names. Other text (such as Korean) is put on the system clipboard and pasted with Command+V, so a run replaces what the clipboard held",
        "headings.list and links.list open the rotor (VO+U), press Right until English or Korean speech names the Headings or Links list, read with Down until the list wraps to its start, stays on its last item or goes silent, then press Escape; headings.list was checked on one live VoiceOver with English speech, links.list was not",
        "formControls.rotor opens the rotor on its Form Controls list the same way and leaves it open: next/previous press Down/Up, activate presses Return (goes to the item), Escape closes it, and any other action presses Escape first. Checked on one live VoiceOver with English speech; the Korean list name (폼 컨트롤 or 양식 컨트롤) was not",
        "heading.previous, form.previous and link.previous run VoiceOver's find previous heading/control/link commands through AppleScript, because the AT Driver server's VO+Command+Shift+H/J/L reaches VoiceOver as Find Next. Checked on one live VoiceOver",
        "A new page whose cursor stays on the browser's controls is entered by pressing next until VoiceOver's cursor covers the page's area on the screen, then VO+Shift+Down; the place is read from the screen, not from speech. Checked on one live VoiceOver in Chrome; other browsers were not"],
    sources: [
      "https://github.com/bocoup/macos-at-driver-server/blob/main/lib/modules/interaction.js",
      "https://github.com/bocoup/macos-at-driver-server/blob/main/lib/helpers/parseCodePoints.js",
      "https://support.apple.com/guide/voiceover/navigation-commands-cpvokys04/mac",
      "https://support.apple.com/guide/voiceover/interaction-commands-cpvokys07/mac",
      "https://support.apple.com/guide/voiceover/search-commands-cpvokys08/mac",
      "/System/Library/PrivateFrameworks/ScreenReader.framework/Resources/SCRStringsToCommandsMap.scrconfig",
    ],
  },
  nvda: {
    atName: "NVDA", platformName: "windows", platform: "win32",
    intents: nvdaIntents, routines: {}, rotors: {}, commands: {},
    commandKey: AT_DRIVER_KEYS.Control, punctuationKeys: false, pastesText: false,
    assumptions: [KEYBOARD_ASSUMPTION,
        "Navigation intents require NVDA browse mode; next/previous move by line",
        "No interact/stopInteracting mapping: NVDA mode toggling is not an idempotent semantic action",
        "Text is limited to ASCII letters, digits, spaces, shifted digits, semicolon, colon, equals and plus by the PAC server key parser",
    ],
    sources: [
      "https://github.com/Prime-Access-Consulting/nvda-at-automation/blob/main/NVDAPlugin/globalPlugins/CommandSocket/keyboard_input.py",
      "https://download.nvaccess.org/documentation/en/userGuide.html#BrowseMode",
    ],
  },
});

export function getAtDriverProfile(name: AtDriverProfileName): AtDriverProfile {
  if (!Object.hasOwn(PROFILE_SPECS, name)) throw new Error(`Unsupported AT Driver profile: ${String(name)}`);
  const spec = PROFILE_SPECS[name], { intents, routines, rotors, commands } = spec;
  const pasteText = (action: AtDriverAction) =>
    spec.pastesText && (action.kind === "typeText" || action.kind === "replaceText") && !typeable(action.text, spec) ? action.text : undefined;
  const capabilities = Object.freeze({ intents: Object.freeze([...Object.keys(intents), ...Object.keys(commands), ...Object.keys(routines), ...Object.keys(rotors)]), keys: allowedKeys, textEntry: true, replaceText: true });
  return {
    name,
    atName: spec.atName,
    platformName: spec.platformName,
    platform: spec.platform,
    ...(spec.hostHelpers ? { hostHelpers: spec.hostHelpers } : {}),
    capabilities,
    assumptions: spec.assumptions,
    sources: spec.sources,
    routines,
    rotors,
    commands,
    ...(spec.pageEntry ? { pageEntry: spec.pageEntry } : {}),
    pasteText,
    mapAction(action) {
      if (action.kind === "intent") {
        if (!Object.hasOwn(intents, action.intent)) throw new AtDriverError(`Unsupported ${name} intent: ${action.intent}`, "unsupported action");
        return [[...intents[action.intent]!]];
      }
      if (action.kind === "key") {
        if (!allowedKeys.includes(action.key)) throw new AtDriverError(`Unsupported ${name} key: ${action.key}`, "unsupported action");
        if (action.key === "Mod+A") return [[spec.commandKey, "a"]];
        if (action.key.startsWith("Shift+")) return [[AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS[action.key.slice(6) as keyof typeof AT_DRIVER_KEYS]]];
        return [[AT_DRIVER_KEYS[action.key as keyof typeof AT_DRIVER_KEYS]]];
      }
      if (action.kind === "typeText" || action.kind === "replaceText") {
        const presses = pasteText(action) === undefined ? textKeys(action.text, spec) : [[spec.commandKey, "v"]];
        return action.kind === "replaceText" ? [[spec.commandKey, "a"], [AT_DRIVER_KEYS.Backspace], ...presses] : presses;
      }
      throw new AtDriverError("Unknown action kind", "unsupported action");
    },
  };
}
