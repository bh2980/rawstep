import {
  BACKEND_SPEC,
  SCREEN_READER_BACKEND_IDS,
  backendSupportsPlatform,
  backendSupportsRawPerform,
  formatScreenReaderBackendIdList,
  getBackendBrowserPolicy,
  getScreenReaderBackendCapabilities,
  parseScreenReaderBackendId,
} from "@rawstep/definition";
import { describe, expect, it } from "vitest";

describe("backend definitions", () => {
  it("keeps the backend spec aligned with the backend id list", () => {
    expect(Object.keys(BACKEND_SPEC)).toEqual(SCREEN_READER_BACKEND_IDS);
  });

  it("describes platform, browser, and raw-perform policy for each backend", () => {
    expect(BACKEND_SPEC["guidepup-voiceover"]).toEqual({
      platforms: ["darwin"],
      browser: {
        defaultHeadless: false,
        headlessAllowed: false
      },
      supportsRawPerform: true
    });
    expect(BACKEND_SPEC["guidepup-nvda"]).toEqual({
      platforms: ["win32"],
      browser: {
        defaultHeadless: false,
        headlessAllowed: false
      },
      supportsRawPerform: true
    });
    expect(BACKEND_SPEC["guidepup-virtual"]).toEqual({
      platforms: ["darwin", "linux", "win32"],
      browser: {
        defaultHeadless: true,
        headlessAllowed: true
      },
      supportsRawPerform: false
    });
  });

  it("parses backend ids and reports the centralized backend list in errors", () => {
    expect(parseScreenReaderBackendId("guidepup-virtual")).toBe("guidepup-virtual");
    expect(() => parseScreenReaderBackendId("auto", "screenReaderBackend")).toThrow(
      `screenReaderBackend must be one of ${formatScreenReaderBackendIdList()}.`
    );
  });

  it("answers derived backend policy helpers from the spec", () => {
    expect(backendSupportsPlatform("guidepup-voiceover", "darwin")).toBe(true);
    expect(backendSupportsPlatform("guidepup-voiceover", "win32")).toBe(false);
    expect(backendSupportsRawPerform("guidepup-nvda")).toBe(true);
    expect(backendSupportsRawPerform("guidepup-virtual")).toBe(false);
    expect(getBackendBrowserPolicy("guidepup-virtual")).toEqual({
      defaultHeadless: true,
      headlessAllowed: true
    });
  });

  it("returns backend capability snapshots from the centralized definition layer", () => {
    const voiceOver = getScreenReaderBackendCapabilities("guidepup-voiceover");
    const virtual = getScreenReaderBackendCapabilities("guidepup-virtual");

    expect(voiceOver.invoke.supportsRawPerform).toBe(true);
    expect(voiceOver.performCatalog[0]?.id).toBeTruthy();
    expect(virtual.invoke.supportsRawPerform).toBe(false);
    expect(virtual.performCatalog.some((command) => command.id === "commands.moveToNextHeading")).toBe(true);
  });
});
