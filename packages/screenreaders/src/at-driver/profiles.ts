import { AtDriverError } from "./transport.js";

export type AtDriverProfileName = "voiceover" | "nvda";
export type AtDriverAction =
  | { kind: "intent"; intent: string }
  | { kind: "key"; key: string }
  | { kind: "typeText" | "replaceText"; text: string };

export interface AtDriverCapabilities {
  intents: readonly string[];
  keys: readonly string[];
  textEntry: boolean;
  replaceText: boolean;
}

// WebDriver key code points, as used by AT Driver pressKeys.
export const AT_DRIVER_KEYS = Object.freeze({
  Backspace: "\uE003", Tab: "\uE004", Enter: "\uE006", Shift: "\uE008",
  Control: "\uE009", Alt: "\uE00A", Escape: "\uE00C", Space: "\uE00D",
  PageUp: "\uE00E", PageDown: "\uE00F", End: "\uE010", Home: "\uE011",
  ArrowLeft: "\uE012", ArrowUp: "\uE013", ArrowRight: "\uE014", ArrowDown: "\uE015",
  Delete: "\uE017", Semicolon: "\uE018", Equal: "\uE019", Meta: "\uE03D",
});

const simpleKeys = ["Tab", "Enter", "Escape", "Space", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"] as const;
const allowedKeys = Object.freeze([...simpleKeys, "Shift+Tab", "Shift+Enter", "Mod+A"]);
const vo = [AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt];
const voiceoverIntents: Readonly<Record<string, readonly string[]>> = Object.freeze({
  next: [...vo, AT_DRIVER_KEYS.ArrowRight],
  previous: [...vo, AT_DRIVER_KEYS.ArrowLeft],
  activate: [...vo, AT_DRIVER_KEYS.Space],
  interact: [...vo, AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.ArrowDown],
  stopInteracting: [...vo, AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.ArrowUp],
  "heading.next": [...vo, AT_DRIVER_KEYS.Meta, "h"],
  "heading.previous": [...vo, AT_DRIVER_KEYS.Meta, AT_DRIVER_KEYS.Shift, "h"],
  "form.next": [...vo, AT_DRIVER_KEYS.Meta, "j"],
});
const nvdaIntents: Readonly<Record<string, readonly string[]>> = Object.freeze({
  next: [AT_DRIVER_KEYS.ArrowDown], // Browse-mode next line, not VoiceOver's next object.
  previous: [AT_DRIVER_KEYS.ArrowUp],
  activate: [AT_DRIVER_KEYS.Enter],
  "heading.next": ["h"],
  "heading.previous": [AT_DRIVER_KEYS.Shift, "h"],
  "form.next": ["f"],
});

export interface AtDriverProfile {
  name: AtDriverProfileName;
  atName: string;
  platformName: string;
  capabilities: AtDriverCapabilities;
  assumptions: readonly string[];
  sources: readonly string[];
  mapAction(action: AtDriverAction): string[][];
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

function textKeys(text: string, profile: AtDriverProfileName): string[][] {
  // Validate the complete text before returning ANY key presses, particularly a destructive replace.
  // No clipboard/DOM fallback, hidden focus repair, extension intent, or synthesized speech.
  return Array.from(text, character => {
    if (/^[a-z0-9]$/.test(character)) return [character];
    if (/^[A-Z]$/.test(character)) return [AT_DRIVER_KEYS.Shift, character.toLowerCase()];
    if (character === " ") return [AT_DRIVER_KEYS.Space];
    if (Object.hasOwn(shiftedDigits, character)) return [AT_DRIVER_KEYS.Shift, shiftedDigits[character]!];
    if (character === ";" || character === ":") return character === ";" ? [AT_DRIVER_KEYS.Semicolon] : [AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.Semicolon];
    if (character === "=" || character === "+") return character === "=" ? [AT_DRIVER_KEYS.Equal] : [AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.Equal];
    // Bocoup's macOS server explicitly supports these key names. The PAC NVDA
    // server only accepts alphanumeric characters and its enumerated key codes.
    if (profile === "voiceover") {
      if (Object.hasOwn(macPunctuation, character)) return [macPunctuation[character]!];
      if (Object.hasOwn(shiftedPunctuation, character)) return [AT_DRIVER_KEYS.Shift, macPunctuation[shiftedPunctuation[character]!]!];
    }
    throw new AtDriverError(`Text contains a character unsupported by the ${profile} key profile (U+${character.codePointAt(0)!.toString(16).toUpperCase()})`, "unsupported action");
  });
}

export function getAtDriverProfile(name: AtDriverProfileName): AtDriverProfile {
  if (name !== "voiceover" && name !== "nvda") throw new Error(`Unsupported AT Driver profile: ${String(name)}`);
  const intents = name === "voiceover" ? voiceoverIntents : nvdaIntents;
  const capabilities = Object.freeze({ intents: Object.freeze(Object.keys(intents)), keys: allowedKeys, textEntry: true, replaceText: true });
  return {
    name,
    atName: name === "voiceover" ? "VoiceOver" : "NVDA",
    platformName: name === "voiceover" ? "macos" : "windows",
    capabilities,
    assumptions: [
      "US keyboard layout and default key bindings; actual layout and bindings are unknown",
      ...(name === "voiceover" ? ["VoiceOver modifier is Control+Option", "Printable ASCII text only; punctuation uses Bocoup macOS server key names"] : [
        "Navigation intents require NVDA browse mode; next/previous move by line",
        "No interact/stopInteracting mapping: NVDA mode toggling is not an idempotent semantic action",
        "Text is limited to ASCII letters, digits, spaces, shifted digits, semicolon, colon, equals and plus by the PAC server key parser",
      ]),
    ],
    sources: name === "voiceover" ? [
      "https://github.com/bocoup/macos-at-driver-server/blob/main/lib/modules/interaction.js",
      "https://github.com/bocoup/macos-at-driver-server/blob/main/lib/helpers/parseCodePoints.js",
      "https://support.apple.com/guide/voiceover/navigation-commands-cpvokys04/mac",
      "https://support.apple.com/guide/voiceover/interaction-commands-cpvokys07/mac",
      "https://support.apple.com/guide/voiceover/search-commands-cpvokys08/mac",
    ] : [
      "https://github.com/Prime-Access-Consulting/nvda-at-automation/blob/main/NVDAPlugin/globalPlugins/CommandSocket/keyboard_input.py",
      "https://download.nvaccess.org/documentation/en/userGuide.html#BrowseMode",
    ],
    mapAction(action) {
      if (action.kind === "intent") {
        if (!Object.hasOwn(intents, action.intent)) throw new AtDriverError(`Unsupported ${name} intent: ${action.intent}`, "unsupported action");
        return [[...intents[action.intent]!]];
      }
      if (action.kind === "key") {
        if (!allowedKeys.includes(action.key as typeof allowedKeys[number])) throw new AtDriverError(`Unsupported ${name} key: ${action.key}`, "unsupported action");
        if (action.key === "Mod+A") return [[name === "voiceover" ? AT_DRIVER_KEYS.Meta : AT_DRIVER_KEYS.Control, "a"]];
        if (action.key.startsWith("Shift+")) return [[AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS[action.key.slice(6) as keyof typeof AT_DRIVER_KEYS]]];
        return [[AT_DRIVER_KEYS[action.key as keyof typeof AT_DRIVER_KEYS]]];
      }
      if (action.kind === "typeText" || action.kind === "replaceText") {
        const presses = textKeys(action.text, name);
        return action.kind === "replaceText" ? [[name === "voiceover" ? AT_DRIVER_KEYS.Meta : AT_DRIVER_KEYS.Control, "a"], [AT_DRIVER_KEYS.Backspace], ...presses] : presses;
      }
      throw new AtDriverError("Unknown action kind", "unsupported action");
    },
  };
}
