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
      "screenreader-strict",
      "screenreader-hybrid"
    ]);

    expect(Object.keys(MODE_SPEC)).toEqual([...USER_MODEL_VALUES]);
  });

  it("parses supported mode values and rejects unsupported ones", () => {
    expect(parseUserModel("keyboard")).toBe("keyboard");
    expect(parseUserModel("screenreader-strict")).toBe("screenreader-strict");
    expect(parseUserModel("screenreader-hybrid")).toBe("screenreader-hybrid");

    expect(isUserModel("keyboard")).toBe(true);
    expect(isUserModel("screenreader")).toBe(false);
    expect(() => parseUserModel("screenreader")).toThrow(
      "Unsupported mode: screenreader. Expected one of keyboard, screenreader-strict, screenreader-hybrid."
    );
  });

  it("derives mode behavior from MODE_SPEC", () => {
    expect(isScreenReaderMode("keyboard")).toBe(false);
    expect(allowsRawKeyActions("keyboard")).toBe(true);
    expect(requiresScreenReaderBackend("keyboard")).toBe(false);
    expect(supportsVisualObservation("keyboard")).toBe(true);
    expect(supportsScreenReaderObservation("keyboard")).toBe(false);

    expect(isScreenReaderMode("screenreader-strict")).toBe(true);
    expect(allowsRawKeyActions("screenreader-strict")).toBe(false);
    expect(requiresScreenReaderBackend("screenreader-strict")).toBe(true);
    expect(supportsVisualObservation("screenreader-strict")).toBe(false);
    expect(supportsScreenReaderObservation("screenreader-strict")).toBe(true);

    expect(isScreenReaderMode("screenreader-hybrid")).toBe(true);
    expect(allowsRawKeyActions("screenreader-hybrid")).toBe(true);
    expect(requiresScreenReaderBackend("screenreader-hybrid")).toBe(true);
    expect(supportsVisualObservation("screenreader-hybrid")).toBe(false);
    expect(supportsScreenReaderObservation("screenreader-hybrid")).toBe(true);
  });
});
