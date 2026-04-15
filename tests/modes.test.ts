import {
  allowsRawKeyActions,
  isScreenReaderMode,
  isUserModel,
  MODE_SPEC,
  parseUserModel,
  requiresScreenReaderBackend,
  supportsScreenReaderObservation,
  supportsVisualObservation,
  USER_MODEL_VALUES,
} from "@rawstep/definition";
import { describe, expect, it } from "vitest";

describe("mode policy", () => {
  it("exports the supported mode values in definition", () => {
    expect(USER_MODEL_VALUES).toEqual([
      "keyboard",
      "screenreader"
    ]);

    expect(Object.keys(MODE_SPEC)).toEqual([...USER_MODEL_VALUES]);
  });

  it("parses supported mode values and rejects unsupported ones", () => {
    expect(parseUserModel("keyboard")).toBe("keyboard");
    expect(parseUserModel("screenreader")).toBe("screenreader");

    expect(isUserModel("keyboard")).toBe(true);
    expect(isUserModel("screenreader")).toBe(true);
    expect(() => parseUserModel("screenreader-strict")).toThrow(
      "Unsupported mode: screenreader-strict. Expected one of keyboard, screenreader."
    );
    expect(() => parseUserModel("screenreader-hybrid")).toThrow(
      "Unsupported mode: screenreader-hybrid. Expected one of keyboard, screenreader."
    );
    expect(() => parseUserModel("screenReader")).toThrow(
      "Unsupported mode: screenReader. Expected one of keyboard, screenreader."
    );
    expect(() => parseUserModel("screen-reader")).toThrow(
      "Unsupported mode: screen-reader. Expected one of keyboard, screenreader."
    );
    expect(() => parseUserModel("sr")).toThrow(
      "Unsupported mode: sr. Expected one of keyboard, screenreader."
    );
  });

  it("derives mode behavior from MODE_SPEC", () => {
    expect(isScreenReaderMode("keyboard")).toBe(false);
    expect(allowsRawKeyActions("keyboard")).toBe(true);
    expect(requiresScreenReaderBackend("keyboard")).toBe(false);
    expect(supportsVisualObservation("keyboard")).toBe(true);
    expect(supportsScreenReaderObservation("keyboard")).toBe(false);

    expect(isScreenReaderMode("screenreader")).toBe(true);
    expect(allowsRawKeyActions("screenreader")).toBe(false);
    expect(requiresScreenReaderBackend("screenreader")).toBe(true);
    expect(supportsVisualObservation("screenreader")).toBe(false);
    expect(supportsScreenReaderObservation("screenreader")).toBe(true);
  });
});
