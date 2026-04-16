import { describe, expect, it } from "vitest";
import { buildProviderOptions } from "../packages/agent/src/providers";

describe("provider options", () => {
  it("passes configured provider options through", () => {
    expect(buildProviderOptions({
      provider: "openai-compatible",
      apiKey: "shared-key",
      model: "openai/gpt-5.4-mini",
      baseURL: "https://openrouter.ai/api/v1",
      providerOptions: {
        openaiCompatible: {
          reasoningEffort: "high",
          reasoningSummary: "detailed"
        }
      }
    })).toEqual({
      openaiCompatible: {
        reasoningEffort: "high",
        reasoningSummary: "detailed"
      }
    });
  });

  it("returns undefined when provider options are not configured", () => {
    expect(buildProviderOptions({
      provider: "openai-compatible",
      apiKey: "shared-key",
      model: "openai/gpt-5.4-mini",
      baseURL: "https://openrouter.ai/api/v1"
    })).toBeUndefined();
  });
});
