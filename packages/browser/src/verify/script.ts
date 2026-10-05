import type { CDPSession, Page } from "playwright";
import type { ScriptCheckError } from "@rawstep/core/contracts";

export const SCRIPT_TIMEOUT_MS = 2000;
const SCRIPT_WORLD = "rawstep-verify";

export type ScriptCheckResult = { result: boolean } | { result: null; error: ScriptCheckError };

/**
 * Runs a reviewed `script` rule in a fresh isolated world of the main frame: it shares the page DOM but not page
 * JavaScript, so page code can neither see nor patch it. Network APIs are removed from that world as a guard,
 * not a sandbox: the DOM can still load resources, which is why scripts must be read before they are saved.
 * Only a boolean leaves the page; thrown messages stay there because they can quote page text.
 */
export async function runScriptCheck(page: Page, source: string, context: unknown, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<ScriptCheckResult> {
  let cdp: CDPSession | undefined;
  try {
    cdp = await page.context().newCDPSession(page);
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const { executionContextId } = await cdp.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: SCRIPT_WORLD });
    const evaluation = cdp.send("Runtime.evaluate", {
      expression: scriptExpression(source, context, timeoutMs),
      contextId: executionContextId,
      returnByValue: true,
      awaitPromise: true,
      // Ends a synchronous endless loop; the in-page race covers promises that never settle.
      timeout: timeoutMs
    });
    const outcome = await Promise.race([
      evaluation,
      new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), timeoutMs + 1000).unref())
    ]);
    if (outcome === "timeout") return { result: null, error: "timeout" };
    if (outcome.exceptionDetails) {
      // A source that does not parse also lands here; Runtime.evaluate's own timeout reports a terminated execution.
      const detail = `${outcome.exceptionDetails.text} ${outcome.exceptionDetails.exception?.description ?? ""}`;
      return { result: null, error: /terminated/i.test(detail) ? "timeout" : "threw" };
    }
    const value = outcome.result.value as { verdict?: unknown; error?: ScriptCheckError } | undefined;
    if (value?.error) return { result: null, error: value.error };
    return typeof value?.verdict === "boolean" ? { result: value.verdict } : { result: null, error: "not-boolean" };
  } catch {
    // Navigation destroying the world, a closed page, or CDP being unavailable.
    return { result: null, error: "unavailable" };
  } finally {
    await cdp?.detach().catch(() => undefined);
  }
}

function scriptExpression(source: string, context: unknown, timeoutMs: number): string {
  return `(async () => {
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker"]) {
    try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false }); } catch {}
  }
  try { Object.defineProperty(Navigator.prototype, "sendBeacon", { value: () => false, configurable: false }); } catch {}
  let check;
  try { check = (${source}\n); } catch { return { error: "threw" }; }
  if (typeof check !== "function") return { error: "not-function" };
  const context = Object.freeze(${JSON.stringify(context ?? {})});
  const timedOut = Symbol("timeout");
  try {
    const verdict = await Promise.race([
      Promise.resolve().then(() => check(context)),
      new Promise(resolve => setTimeout(() => resolve(timedOut), ${timeoutMs}))
    ]);
    if (verdict === timedOut) return { error: "timeout" };
    return typeof verdict === "boolean" ? { verdict } : { error: "not-boolean" };
  } catch { return { error: "threw" }; }
})()`;
}
