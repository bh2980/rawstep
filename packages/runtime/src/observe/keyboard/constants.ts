import type { ScrollHint } from "@rawstep/core";

export const SCROLL_HINTS = ["top", "middle", "bottom"] as const satisfies readonly ScrollHint[];

export function isScrollHint(value: string): value is ScrollHint {
  return (SCROLL_HINTS as readonly string[]).includes(value);
}
