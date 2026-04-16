import {
  defineConfig,
  kb,
  sr,
  type ProjectConfigSource,
} from "@rawstep/config";

const providerFromEnv = process.env.AI_PROVIDER;
const resolvedProvider =
  providerFromEnv === "anthropic" || providerFromEnv === "openai-compatible"
    ? providerFromEnv
    : undefined;

const config: ProjectConfigSource = defineConfig({
  version: 1,
  defaults: {
    provider: resolvedProvider,
    model: process.env.AI_MODEL,
    baseURL: process.env.AI_BASE_URL,
    apiKey: process.env.AI_API_KEY,
    providerOptions:
      resolvedProvider === "openai-compatible"
        ? {
            openaiCompatible: {
              reasoningEffort: "high",
            },
          }
        : undefined,
  },
  modes: {
    keyboard: {
      maxSteps: 30,
      timeoutMs: 240000,
      headless: true,
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all",
      allowedKeys: [
        kb.arrow.down({
          hint: "Use ArrowDown to scroll downward or move downward inside a composite widget.",
        }),
        kb.arrow.left({
          hint: "Use ArrowLeft to move left inside a composite widget.",
        }),
        kb.arrow.right({
          hint: "Use ArrowRight to move right inside a composite widget.",
        }),
        kb.arrow.up({
          hint: "Use ArrowUp to scroll upward or move upward inside a composite widget.",
        }),
        kb.enter({
          hint: "Use Enter to activate the currently focused element.",
        }),
        kb.escape({
          hint: "Use Escape to close an open dialog, menu, or popup, or to clear the current state.",
        }),
        kb.shiftTab({
          hint: "Use Shift+Tab to move to the previous focusable element.",
        }),
        kb.space({
          hint: "Use Space to activate or toggle the currently focused element.",
        }),
        kb.tab({
          hint: "Use Tab to move to the next focusable element.",
        }),
        kb.home({
          hint: "Use Home to jump toward the start of the current context.",
        }),
        kb.end({
          hint: "Use End to jump toward the end of the current context.",
        }),
      ],
    },
    screenreader: {
      headless: false,
      maxSteps: 200,
      timeoutMs: 600000,
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [
        sr.next({
          hint: "Use next to move the VoiceOver cursor to the next readable item. When surveying structure broadly, consider it before Tab.",
        }),
        sr.previous({
          hint: "Use previous to move the VoiceOver cursor to the previous readable item. Use it to return to something you just passed.",
        }),

        sr.form.next({
          hint: "Use form.next to move to the next form control such as an input, checkbox, select, or button. Check it first when looking for fields.",
        }),
        sr.form.previous({
          hint: "Use form.previous to move to the previous form control. Use it to return to a field or checkbox you just passed.",
        }),
        sr.heading.next({
          hint: "Use heading.next to move broadly to the next heading. Use it to understand the page structure quickly or skip sections.",
        }),
        sr.heading.previous({
          hint: "Use heading.previous to move to the previous heading. Use it when returning to an earlier section to reestablish structure.",
        }),
        sr.landmark.next({
          hint: "Use landmark.next to move to the next landmark region. Use it to locate major areas such as main, navigation, or forms quickly.",
        }),
        sr.landmark.previous({
          hint: "Use landmark.previous to move to the previous landmark region. Use it to return to a major area you passed.",
        }),
        sr.interact({
          hint: "Use interact to enter the current group or web area so you can read in more detail or prepare to operate it. It is often needed before real input after locating the right area.",
        }),
        sr.stopInteracting({
          hint: "Use stopInteracting to leave the current interaction context. Use it to return to broader structural exploration after going deeper.",
        }),
        sr.act({
          hint: "Use act to trigger the default action of the item under the VoiceOver cursor. Use it only when the current item is clearly a button, link, checkbox, or similar control.",
        }),
        sr.key.arrow.down({
          hint: "Use ArrowDown only when the current context expects arrow navigation. Use it in lists, menus, composite widgets, or for vertical movement.",
        }),
        sr.key.arrow.left({
          hint: "Use ArrowLeft only when the current context expects left-right movement. Use it inside composite widgets such as tabs, grids, or sliders.",
        }),
        sr.key.arrow.right({
          hint: "Use ArrowRight only when the current context expects left-right movement. Use it inside composite widgets such as tabs, grids, or sliders.",
        }),
        sr.key.arrow.up({
          hint: "Use ArrowUp only when the current context expects arrow navigation. Use it to move back upward inside lists, menus, or composite widgets.",
        }),
        sr.key.enter({
          hint: "Use Enter to activate or submit the current item. Use it only when the cursor is on a button, link, or another clear control.",
        }),
        sr.key.escape({
          hint: "Use Escape to close an open dialog, menu, or popup, or to clear the current state. Consider it first when unexpected browser UI gets in the way.",
        }),
        sr.key.space({
          hint: "Use Space to activate or toggle the current item. Use it where a Space response is natural, such as checkboxes, buttons, or toggles.",
        }),
        // sr.key.shiftTab({
        //   hint: "Use Shift+Tab to move keyboard focus to the previous focusable element. It is not a primary exploration method and should be used only when there is reason to believe the page already has keyboard focus.",
        // }),
        // sr.key.tab({
        //   hint: "Use Tab to move keyboard focus to the next focusable element. It is not a primary exploration method and should be used only when there is reason to believe the page already has keyboard focus.",
        // }),
        // sr.key.home({
        //   hint: "Use Home to jump broadly toward the start of the current context. Use it to return quickly to the beginning of a long list or context.",
        // }),
        // sr.key.end({
        //   hint: "Use End to jump broadly toward the end of the current context. Use it to move quickly to the last part of a long list or context.",
        // }),
      ],
    },
  },
});

export default config;
