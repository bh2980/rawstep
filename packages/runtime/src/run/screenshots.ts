import type { BrowserSession } from "../browser";
import type {
  Decision,
  Observation,
  ScreenshotPolicy
} from "@rawstep/core";

export function shouldCaptureDeveloperScreenshot(
  policy: ScreenshotPolicy,
  observation: Observation,
  decision: Decision,
  execution?: { ok: boolean },
  verification?: { passed: boolean },
  forceCapture = false
): boolean {
  if (observation.kind !== "screenreader") {
    return false;
  }

  switch (policy) {
    case "all":
      return true;
    case "none":
      return false;
    case "failure-only":
      if (forceCapture) {
        return true;
      }

      if (verification) {
        return !verification.passed;
      }

      if ("verdict" in decision) {
        return decision.verdict !== "success";
      }

      return execution?.ok === false;
    case "important":
      if (verification) {
        return true;
      }

      if ("verdict" in decision) {
        return true;
      }

      if (execution?.ok === false) {
        return true;
      }

      if ("action" in decision) {
        if ("typeText" in decision.action) {
          return true;
        }

        if ("srAction" in decision.action) {
          if ("extension" in decision.action.srAction) {
            return false;
          }

          switch (decision.action.srAction.semantic) {
            case "type":
            case "press":
            case "interact":
            case "stopInteracting":
            case "click":
            case "read.itemText":
            case "read.itemTextLog":
            case "read.lastSpokenPhrase":
            case "read.spokenPhraseLog":
            case "clear.itemTextLog":
            case "clear.spokenPhraseLog":
              return true;
            default:
              return false;
          }
        }
      }

      return false;
  }
}

export async function captureDeveloperScreenshot(
  page: BrowserSession["page"]
): Promise<{ pngBase64: string; viewport: { w: number; h: number } }> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const buffer = await page.screenshot({ type: "png" });

  return {
    pngBase64: buffer.toString("base64"),
    viewport: { w: viewport.width, h: viewport.height }
  };
}
