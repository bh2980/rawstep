import type { Action } from "@rawstep/core";
import { posix } from "node:path";

export function formatAction(action: Action): string {
  if ("key" in action) {
    return action.key;
  }

  if ("srAction" in action) {
    if (action.srAction.kind === "read") {
      return `srAction.read(${action.srAction.method})`;
    }

    if (action.srAction.kind === "maintenance") {
      return `srAction.maintenance(${action.srAction.method})`;
    }

    switch (action.srAction.method) {
      case "next":
      case "previous":
      case "act":
      case "interact":
      case "stopInteracting":
        return `srAction.invoke(${action.srAction.method})`;
      case "perform":
        return action.srAction.command.source === "catalog"
          ? `srAction.perform(${action.srAction.command.id})`
          : "srAction.perform(raw)";
      case "press":
        return `srAction.press(${action.srAction.key})`;
      case "type":
        return `srAction.type(${action.srAction.text})`;
      case "click":
        return `srAction.click(${action.srAction.options?.button ?? "left"},${action.srAction.options?.clickCount ?? 1})`;
    }
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
