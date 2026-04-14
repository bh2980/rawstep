import type { AllowedKey } from "@rawstep/core";

export function resolveKeyboardPressKey(
  key: AllowedKey,
  platform = process.platform
): string {
  switch (key) {
    case "Mod+A":
      return platform === "darwin" ? "Meta+A" : "Control+A";
    case "Mod+Backspace":
      return platform === "darwin" ? "Meta+Backspace" : "Control+Backspace";
    case "Mod+Delete":
      return platform === "darwin" ? "Meta+Delete" : "Control+Delete";
    case "Mod+Z":
      return platform === "darwin" ? "Meta+Z" : "Control+Z";
    case "Mod+Shift+Z":
      return platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    default:
      return key;
  }
}
