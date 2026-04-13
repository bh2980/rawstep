import type { Action } from "@rawstep/core";
import { posix } from "node:path";

export function formatAction(action: Action): string {
  if ("key" in action) {
    return action.key;
  }

  if ("srCommand" in action) {
    return `srCommand(${action.srCommand})`;
  }

  return `typeText(${action.typeText})`;
}

export function toReportImagePath(relativeScreenshotPath: string): string {
  return posix.join("..", ...relativeScreenshotPath.split("/"));
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
