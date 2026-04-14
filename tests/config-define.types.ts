import { defineConfig, kb, sr } from "../apps/cli/src/config-define";

defineConfig({
  version: 1,
  defaults: {
    prompt: {
      dir: "./prompt"
    }
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      allowedKeys: [kb.tab(), kb.enter()]
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
      allowedKeys: [kb.tab()],
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
      allowedKeys: [kb.tab()]
    }
  }
});

defineConfig({
  version: 1,
  defaults: {
    prompt: {
      // @ts-expect-error defaults.prompt must not accept extraInstructions
      extraInstructions: "Stay conservative."
    }
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
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
      // @ts-expect-error raw string literals are not part of the public config API
      allowedKeys: ["Tab"]
    }
  }
});
