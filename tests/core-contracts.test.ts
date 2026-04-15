import * as definition from "../packages/definition/src";
import { describe, expect, it } from "vitest";

describe("@rawstep/definition contract surface", () => {
  it("does not expose value-level helpers or runtime constants", () => {
    expect("formatDecisionAction" in definition).toBe(false);
    expect("DEFAULT_VIEWPORT" in definition).toBe(false);
    expect("SETTLE_MS" in definition).toBe(false);
    expect("isAllowedKey" in definition).toBe(false);
    expect("createEmptyKeyCounts" in definition).toBe(false);
  });
});
