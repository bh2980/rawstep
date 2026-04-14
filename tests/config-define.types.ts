import { defineConfig, kb, sr, srUnstable } from "../apps/cli/src/config-define";
import { z } from "zod";

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
        sr.link.next(),
        sr.landmark.previous(),
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
        sr.button.next({ hint: "Move to the next button." }),
        sr.heading.level3.next({ hint: "Move to the next level 3 heading." }),
        sr.click(),
        srUnstable.catalog("commands.jumpToErrorMessageElement", {
          hint: "Move to the current error message.",
          argsSchema: z.object({
            index: z.number().int().nonnegative()
          }),
          argsExample: { index: 1 }
        })
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
      allowedScreenReaderActions: [{
        unstable: "catalog",
        id: "commands.moveToNextHeading",
        hint: "Move to the next heading.",
        argsSchema: z.object({ index: z.number() }),
        argsExample: { index: 1 }
      }]
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
      allowedKeys: [kb.tab()],
      allowedScreenReaderActions: [
        srUnstable.catalog("commands.jumpToErrorMessageElement", {
          hint: "Move to the current error message.",
          argsSchema: z.object({
            index: z.number().int().nonnegative()
          }),
          // @ts-expect-error argsExample must match argsSchema
          argsExample: { index: "wrong" }
        })
      ]
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
