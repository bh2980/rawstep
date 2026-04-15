export const screenReaderBackendIds = [
  "guidepup-voiceover",
  "guidepup-nvda",
  "guidepup-virtual"
] as const;

export type ScreenReaderBackendId = (typeof screenReaderBackendIds)[number];

export type KeyboardActionSource = {
  key: string;
  helperPath: string;
  cliToken: string;
  defaultAllowed: boolean;
};

export type ScreenReaderActionSource = {
  semantic: string;
  helperPath: string;
  kind: "invoke" | "read" | "maintenance" | "catalog";
  argumentKind?: "none" | "key" | "text" | "click";
  backendSupport: readonly ScreenReaderBackendId[];
  catalogIdsByBackend?: Partial<Record<ScreenReaderBackendId, string>>;
  fixedKey?: string;
  defaultAllowed?: boolean;
  public?: boolean;
};

const allBackends = screenReaderBackendIds;
const voiceOverAndNvda = ["guidepup-voiceover", "guidepup-nvda"] as const;
const nvdaAndVirtual = ["guidepup-nvda", "guidepup-virtual"] as const;
const voiceOverNvdaAndVirtual = ["guidepup-voiceover", "guidepup-nvda", "guidepup-virtual"] as const;
const nvdaOnly = ["guidepup-nvda"] as const;

export const keyboardActionSource: readonly KeyboardActionSource[] = [
  { key: "Tab", helperPath: "tab", cliToken: "Tab", defaultAllowed: true },
  { key: "Shift+Tab", helperPath: "shiftTab", cliToken: "Shift+Tab", defaultAllowed: true },
  { key: "Home", helperPath: "home", cliToken: "Home", defaultAllowed: true },
  { key: "End", helperPath: "end", cliToken: "End", defaultAllowed: true },
  { key: "ArrowUp", helperPath: "arrow.up", cliToken: "ArrowUp", defaultAllowed: true },
  { key: "ArrowDown", helperPath: "arrow.down", cliToken: "ArrowDown", defaultAllowed: true },
  { key: "ArrowLeft", helperPath: "arrow.left", cliToken: "ArrowLeft", defaultAllowed: true },
  { key: "ArrowRight", helperPath: "arrow.right", cliToken: "ArrowRight", defaultAllowed: true },
  { key: "Backspace", helperPath: "backspace", cliToken: "Backspace", defaultAllowed: false },
  { key: "Delete", helperPath: "delete", cliToken: "Delete", defaultAllowed: false },
  { key: "Enter", helperPath: "enter", cliToken: "Enter", defaultAllowed: true },
  { key: "Shift+Enter", helperPath: "shiftEnter", cliToken: "Shift+Enter", defaultAllowed: false },
  { key: "Space", helperPath: "space", cliToken: "Space", defaultAllowed: true },
  { key: "Escape", helperPath: "escape", cliToken: "Escape", defaultAllowed: true },
  { key: "Mod+A", helperPath: "mod.a", cliToken: "Mod+A", defaultAllowed: false },
  { key: "Mod+Backspace", helperPath: "mod.backspace", cliToken: "Mod+Backspace", defaultAllowed: false },
  { key: "Mod+Delete", helperPath: "mod.delete", cliToken: "Mod+Delete", defaultAllowed: false },
  { key: "Mod+Z", helperPath: "mod.z", cliToken: "Mod+Z", defaultAllowed: false },
  { key: "Mod+Shift+Z", helperPath: "mod.shiftZ", cliToken: "Mod+Shift+Z", defaultAllowed: false }
] as const;

const screenReaderKeyActionSource: readonly ScreenReaderActionSource[] = keyboardActionSource.map((entry) => ({
  semantic: `key.${entry.helperPath}`,
  helperPath: `key.${entry.helperPath}`,
  kind: "invoke",
  backendSupport: allBackends,
  fixedKey: entry.key,
  defaultAllowed: entry.defaultAllowed
})) as readonly ScreenReaderActionSource[];

export const screenReaderActionSource: readonly ScreenReaderActionSource[] = [
  { semantic: "next", helperPath: "next", kind: "invoke", backendSupport: allBackends },
  { semantic: "previous", helperPath: "previous", kind: "invoke", backendSupport: allBackends },
  { semantic: "act", helperPath: "act", kind: "invoke", backendSupport: allBackends },
  { semantic: "interact", helperPath: "interact", kind: "invoke", backendSupport: allBackends },
  { semantic: "stopInteracting", helperPath: "stopInteracting", kind: "invoke", backendSupport: allBackends },
  { semantic: "press", helperPath: "press", kind: "invoke", argumentKind: "key", backendSupport: allBackends, public: false },
  { semantic: "type", helperPath: "type", kind: "invoke", argumentKind: "text", backendSupport: allBackends },
  { semantic: "click", helperPath: "click", kind: "invoke", argumentKind: "click", backendSupport: allBackends },
  ...screenReaderKeyActionSource,
  {
    semantic: "heading.next",
    helperPath: "heading.next",
    kind: "catalog",
    backendSupport: voiceOverNvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-voiceover": "keyboard.findNextHeading",
      "guidepup-nvda": "keyboard.moveToNextHeading",
      "guidepup-virtual": "commands.moveToNextHeading"
    }
  },
  {
    semantic: "heading.previous",
    helperPath: "heading.previous",
    kind: "catalog",
    backendSupport: voiceOverNvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-voiceover": "keyboard.findPreviousHeading",
      "guidepup-nvda": "keyboard.moveToPreviousHeading",
      "guidepup-virtual": "commands.moveToPreviousHeading"
    }
  },
  {
    semantic: "heading.level.1.next",
    helperPath: "heading.level1.next",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextHeadingLevel1",
      "guidepup-virtual": "commands.moveToNextHeadingLevel1"
    }
  },
  {
    semantic: "heading.level.1.previous",
    helperPath: "heading.level1.previous",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel1",
      "guidepup-virtual": "commands.moveToPreviousHeadingLevel1"
    }
  },
  {
    semantic: "heading.level.2.next",
    helperPath: "heading.level2.next",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextHeadingLevel2",
      "guidepup-virtual": "commands.moveToNextHeadingLevel2"
    }
  },
  {
    semantic: "heading.level.2.previous",
    helperPath: "heading.level2.previous",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel2",
      "guidepup-virtual": "commands.moveToPreviousHeadingLevel2"
    }
  },
  {
    semantic: "heading.level.3.next",
    helperPath: "heading.level3.next",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextHeadingLevel3",
      "guidepup-virtual": "commands.moveToNextHeadingLevel3"
    }
  },
  {
    semantic: "heading.level.3.previous",
    helperPath: "heading.level3.previous",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel3",
      "guidepup-virtual": "commands.moveToPreviousHeadingLevel3"
    }
  },
  {
    semantic: "heading.level.4.next",
    helperPath: "heading.level4.next",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextHeadingLevel4",
      "guidepup-virtual": "commands.moveToNextHeadingLevel4"
    }
  },
  {
    semantic: "heading.level.4.previous",
    helperPath: "heading.level4.previous",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel4",
      "guidepup-virtual": "commands.moveToPreviousHeadingLevel4"
    }
  },
  {
    semantic: "heading.level.5.next",
    helperPath: "heading.level5.next",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextHeadingLevel5",
      "guidepup-virtual": "commands.moveToNextHeadingLevel5"
    }
  },
  {
    semantic: "heading.level.5.previous",
    helperPath: "heading.level5.previous",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel5",
      "guidepup-virtual": "commands.moveToPreviousHeadingLevel5"
    }
  },
  {
    semantic: "heading.level.6.next",
    helperPath: "heading.level6.next",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextHeadingLevel6",
      "guidepup-virtual": "commands.moveToNextHeadingLevel6"
    }
  },
  {
    semantic: "heading.level.6.previous",
    helperPath: "heading.level6.previous",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel6",
      "guidepup-virtual": "commands.moveToPreviousHeadingLevel6"
    }
  },
  {
    semantic: "form.next",
    helperPath: "form.next",
    kind: "catalog",
    backendSupport: voiceOverNvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-voiceover": "keyboard.findNextControl",
      "guidepup-nvda": "keyboard.moveToNextFormField",
      "guidepup-virtual": "commands.moveToNextForm"
    }
  },
  {
    semantic: "form.previous",
    helperPath: "form.previous",
    kind: "catalog",
    backendSupport: voiceOverNvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-voiceover": "keyboard.findPreviousControl",
      "guidepup-nvda": "keyboard.moveToPreviousFormField",
      "guidepup-virtual": "commands.moveToPreviousForm"
    }
  },
  {
    semantic: "link.next",
    helperPath: "link.next",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextLink",
      "guidepup-virtual": "commands.moveToNextLink"
    }
  },
  {
    semantic: "link.previous",
    helperPath: "link.previous",
    kind: "catalog",
    backendSupport: nvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousLink",
      "guidepup-virtual": "commands.moveToPreviousLink"
    }
  },
  {
    semantic: "button.next",
    helperPath: "button.next",
    kind: "catalog",
    backendSupport: voiceOverAndNvda,
    catalogIdsByBackend: {
      "guidepup-voiceover": "commander.FIND_NEXT_BUTTON",
      "guidepup-nvda": "keyboard.moveToNextButton"
    }
  },
  {
    semantic: "button.previous",
    helperPath: "button.previous",
    kind: "catalog",
    backendSupport: voiceOverAndNvda,
    catalogIdsByBackend: {
      "guidepup-voiceover": "commander.FIND_PREVIOUS_BUTTON",
      "guidepup-nvda": "keyboard.moveToPreviousButton"
    }
  },
  {
    semantic: "landmark.next",
    helperPath: "landmark.next",
    kind: "catalog",
    backendSupport: voiceOverNvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-voiceover": "commander.FIND_NEXT_LANDMARK",
      "guidepup-nvda": "keyboard.moveToNextLandmark",
      "guidepup-virtual": "commands.moveToNextLandmark"
    }
  },
  {
    semantic: "landmark.previous",
    helperPath: "landmark.previous",
    kind: "catalog",
    backendSupport: voiceOverNvdaAndVirtual,
    catalogIdsByBackend: {
      "guidepup-voiceover": "commander.FIND_PREVIOUS_LANDMARK",
      "guidepup-nvda": "keyboard.moveToPreviousLandmark",
      "guidepup-virtual": "commands.moveToPreviousLandmark"
    }
  },
  {
    semantic: "list.next",
    helperPath: "list.next",
    kind: "catalog",
    backendSupport: nvdaOnly,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextList"
    }
  },
  {
    semantic: "list.previous",
    helperPath: "list.previous",
    kind: "catalog",
    backendSupport: nvdaOnly,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousList"
    }
  },
  {
    semantic: "table.next",
    helperPath: "table.next",
    kind: "catalog",
    backendSupport: nvdaOnly,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToNextTable"
    }
  },
  {
    semantic: "table.previous",
    helperPath: "table.previous",
    kind: "catalog",
    backendSupport: nvdaOnly,
    catalogIdsByBackend: {
      "guidepup-nvda": "keyboard.moveToPreviousTable"
    }
  },
  { semantic: "read.itemText", helperPath: "read.itemText", kind: "read", backendSupport: allBackends },
  { semantic: "read.itemTextLog", helperPath: "read.itemTextLog", kind: "read", backendSupport: allBackends },
  { semantic: "read.lastSpokenPhrase", helperPath: "read.lastSpokenPhrase", kind: "read", backendSupport: allBackends },
  { semantic: "read.spokenPhraseLog", helperPath: "read.spokenPhraseLog", kind: "read", backendSupport: allBackends },
  {
    semantic: "clear.itemTextLog",
    helperPath: "clear.itemTextLog",
    kind: "maintenance",
    backendSupport: allBackends
  },
  {
    semantic: "clear.spokenPhraseLog",
    helperPath: "clear.spokenPhraseLog",
    kind: "maintenance",
    backendSupport: allBackends
  }
] as const;
