import { formatDecisionAction, type FormattableAction } from "@rawstep/action-catalog";
import { posix } from "node:path";

export function formatAction(action: FormattableAction): string {
  if ("key" in action) {
    return action.key;
  }

  return formatDecisionAction(action);
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
