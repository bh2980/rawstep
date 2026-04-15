import { defineConfig, kb, sr, srx } from "@rawstep/config";
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
      allowedKeys: [
        kb.tab(),
        kb.enter(),
        kb.backspace(),
        kb.shiftEnter(),
        kb.mod.a(),
        kb.mod.z()
      ]
    },
    screenreader: {
      outDir: "./screenreader-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [
        sr.key.tab(),
        sr.heading.next({ hint: "Move to the next heading." }),
        sr.heading.level3.next({ hint: "Move to the next level 3 heading." }),
        sr.click(),
        srx.catalog("commands.jumpToErrorMessageElement", {
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
    screenreader: {
      outDir: "./screenreader-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      // @ts-expect-error screenreader mode must not accept allowedKeys
      allowedKeys: [kb.tab()]
    }
  }
});

defineConfig({
  version: 1,
  modes: {
    screenreader: {
      outDir: "./sr-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-voiceover",
      allowedScreenReaderActions: [
        // @ts-expect-error voiceover config must not accept nvda-only list navigation
        sr.list.next()
      ]
    }
  }
});

defineConfig({
  version: 1,
  modes: {
    screenreader: {
      outDir: "./screenreader-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [
        sr.key.tab(),
        // @ts-expect-error virtual config must not accept voiceover-only button navigation
        sr.button.next()
      ]
    }
  }
});

defineConfig({
  version: 1,
  modes: {
    screenreader: {
      outDir: "./screenreader-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [
        sr.key.tab(),
        // @ts-expect-error virtual config must not accept rawPerform
        srx.rawPerform({
          hint: "Try raw payload.",
          payloadSchema: z.object({
            command: z.string()
          }),
          payloadExample: { command: "custom" }
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
    screenreader: {
      outDir: "./screenreader-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [{
        // @ts-expect-error raw object literals are not part of the public config API
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
    screenreader: {
      outDir: "./screenreader-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [
        sr.key.tab(),
        srx.catalog("commands.jumpToErrorMessageElement", {
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
    screenreader: {
      outDir: "./screenreader-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-nvda",
      allowedScreenReaderActions: [sr.key.tab()]
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

defineConfig({
  version: 1,
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      allowedKeys: [
        kb.delete(),
        kb.mod.backspace(),
        kb.mod.delete(),
        kb.mod.shiftZ()
      ]
    }
  }
});
