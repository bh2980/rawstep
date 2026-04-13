import { defineConfig } from "./apps/cli/src/config-define";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "openai-compatible",
    model: "openrouter/auto",
    baseURL: "https://openrouter.ai/api/v1"
  },
  modes: {
    keyboard: {
      outDir: "./.rawstep/out/keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      verifierAutoComplete: true,
      memory: 5
    },
    "screenreader-strict": {
      outDir: "./.rawstep/out/sr-strict",
      maxSteps: 200,
      timeoutMs: 300000,
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all",
      screenReaderBackend: "guidepup-voiceover",
      allowedScreenReaderCommands: [
        "nextItem",
        "previousItem",
        "nextHeading",
        "previousHeading",
        "nextFormControl",
        "previousFormControl",
        "act"
      ]
    },
    "screenreader-hybrid": {
      outDir: "./.rawstep/out/sr-hybrid",
      maxSteps: 200,
      timeoutMs: 300000,
      screenshots: "important",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderCommands: [
        "nextItem",
        "previousItem",
        "nextHeading",
        "previousHeading",
        "act"
      ]
    }
  }
});
