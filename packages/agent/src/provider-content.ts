import Anthropic from "@anthropic-ai/sdk";
import type { PromptPart } from "./shared";

type OpenAICompatibleContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function toAnthropicMessageContent(promptParts: PromptPart[]): Anthropic.MessageParam["content"] {
  return promptParts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text" as const,
        text: part.text
      };
    }

    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: part.mediaType,
        data: part.base64
      }
    };
  });
}

export function toOpenAICompatibleMessageContent(promptParts: PromptPart[]): OpenAICompatibleContentPart[] {
  return promptParts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        text: part.text
      };
    }

    return {
      type: "image_url",
      image_url: {
        url: `data:${part.mediaType};base64,${part.base64}`
      }
    };
  });
}
