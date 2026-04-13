import type { PromptPart } from "./shared";

export type LanguageModelContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: Uint8Array; mediaType: "image/png" };

export function toLanguageModelContent(promptParts: PromptPart[]): LanguageModelContentPart[] {
  return promptParts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        text: part.text
      };
    }

    return {
      type: "image",
      image: Uint8Array.from(Buffer.from(part.base64, "base64")),
      mediaType: part.mediaType
    };
  });
}
