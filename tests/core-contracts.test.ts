import * as core from "../packages/core/src";
import { describe, expect, it } from "vitest";

describe("@rawstep/core contract surface", () => {
  it("does not expose value-level helpers or runtime constants", () => {
    expect("formatDecisionAction" in core).toBe(false);
    expect("DEFAULT_VIEWPORT" in core).toBe(false);
    expect("SETTLE_MS" in core).toBe(false);
    expect("isAllowedKey" in core).toBe(false);
    expect("createEmptyKeyCounts" in core).toBe(false);
  });
});
