import { defineConfig, sr } from "../apps/cli/src/config-define";

defineConfig({
  version: 1,
  defaults: {
    prompt: {
      dir: "./prompt",
      extraInstructions: "Stay conservative.",
      keyHints: {
        Tab: "Move to the next focusable element."
      }
    }
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      allowedKeys: ["Tab", "Enter"],
      prompt: {
        extraInstructions: "Prefer exploration over activation.",
        keyHints: {
          Enter: "Activate the focused element."
        }
      }
    },
    "screenreader-strict": {
      outDir: "./sr-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-voiceover",
      allowedScreenReaderActions: [
        sr.heading.next(),
        sr.click()
      ]
    },
    "screenreader-hybrid": {
      outDir: "./hybrid-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedKeys: ["Tab"],
      allowedScreenReaderActions: [
        sr.heading.next({ hint: "Move to the next heading." }),
        sr.click()
      ]
    }
  }
});

defineConfig({
  version: 1,
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      // @ts-expect-error keyboard mode must not accept screenReaderBackend
      screenReaderBackend: "guidepup-voiceover"
    }
  }
});

defineConfig({
  version: 1,
  modes: {
    "screenreader-hybrid": {
      outDir: "./hybrid-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      // @ts-expect-error raw object literals are not part of the public config API
      allowedScreenReaderActions: [{ semantic: "catalog", id: "commands.moveToNextHeading" }]
    }
  }
});

defineConfig({
  version: 1,
  modes: {
    "screenreader-strict": {
      outDir: "./sr-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-nvda",
      // @ts-expect-error screenreader-strict must not accept allowedKeys
      allowedKeys: ["Tab"]
    }
  }
});

defineConfig({
  version: 1,
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      prompt: {
        // @ts-expect-error mode prompt must not accept dir
        dir: "./custom-prompt"
      }
    }
  }
});
