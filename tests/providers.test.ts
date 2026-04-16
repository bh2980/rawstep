import { describe, expect, it } from "vitest";
import { buildProviderOptions } from "../packages/agent/src/providers";

describe("provider reasoning options", () => {
  it("builds openai-compatible reasoning options when configured", () => {
    expect(buildProviderOptions({
      provider: "openai-compatible",
      apiKey: "shared-key",
      model: "openai/gpt-5.4-mini",
      baseURL: "https://openrouter.ai/api/v1",
      reasoningEffort: "high"
    })).toEqual({
      openaiCompatible: {
        reasoningEffort: "high"
      }
    });
  });

  it("returns undefined when reasoning effort is not configured", () => {
    expect(buildProviderOptions({
      provider: "openai-compatible",
      apiKey: "shared-key",
      model: "openai/gpt-5.4-mini",
      baseURL: "https://openrouter.ai/api/v1"
    })).toBeUndefined();
  });
});
