/**
 * Smoke run against a live VoiceOver: opens fixtures/smoke.html, presses a short fixed sequence through AT Driver and writes
 * every observation to data/runs/<time>/. It checks that the whole chain works (server, VoiceOver, browser, capture), including
 * the rotor-based `headings.list` routine that has never run on a real VoiceOver.
 *
 * Needs: macOS, VoiceOver on, the AT Driver server running, and nobody touching the Mac while it runs.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AtDriverBackend, type AtDriverAction, type AtDriverObservation } from "rawstep/at-driver";
import { browserApps, frontmostApp, hostFacts, isVoiceOverRunning, openInBrowser, serveDirectory, type BrowserName } from "./host.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  url: { type: "string", default: "ws://localhost:4382/session" },
  browser: { type: "string", default: "safari" },
  out: { type: "string", default: join(packageRoot, "data/runs") },
  "load-wait": { type: "string", default: "3000" },
} });
const browser = values.browser as BrowserName;
if (!(browser in browserApps)) throw new Error(`--browser must be safari or chrome, not ${values.browser}`);

const steps: { label: string; action: AtDriverAction }[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ label: `next ${i + 1}`, action: { kind: "intent", intent: "next" } as const })),
  { label: "previous", action: { kind: "intent", intent: "previous" } },
  { label: "Tab", action: { kind: "key", key: "Tab" } },
  { label: "Shift+Tab", action: { kind: "key", key: "Shift+Tab" } },
  { label: "heading.next", action: { kind: "intent", intent: "heading.next" } },
  { label: "form.next", action: { kind: "intent", intent: "form.next" } },
  { label: "headings.list", action: { kind: "intent", intent: "headings.list" } },
];

if (process.platform !== "darwin") throw new Error("VoiceOver collection runs on macOS only");
if (!(await isVoiceOverRunning())) throw new Error("VoiceOver is not running. Turn it on (Command+F5) and run again.");

const runDir = join(values.out, new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(runDir, { recursive: true });
const records = join(runDir, "records.jsonl");
const fixtures = await serveDirectory(join(packageRoot, "fixtures"));
const backend = new AtDriverBackend({ url: values.url, profile: "voiceover", quietMs: 800, maxWaitMs: 6_000 });
const app = browserApps[browser];

const record = async (label: string, action: AtDriverAction | undefined, observation: AtDriverObservation) => {
  const frontmost = await frontmostApp();
  await appendFile(records, JSON.stringify({ label, action, frontmost, observation }) + "\n");
  const speech = observation.speech.map(text => text.trim()).filter(Boolean).join(" | ") || "(silence)";
  console.log(`${label.padEnd(14)} ${speech}${frontmost === app ? "" : `   ! frontmost: ${frontmost ?? "unknown"}`}`);
};

try {
  console.log("Do not touch the Mac until this finishes. VoiceOver keys go to the frontmost app.");
  const session = await backend.start();
  const facts = await hostFacts(browser);
  await writeFile(join(runDir, "meta.json"), JSON.stringify({ kind: "smoke", fixture: "smoke.html", session, host: facts, steps }, null, 2));
  await record("session.new", undefined, await backend.observe());

  await openInBrowser(browser, `${fixtures.origin}/smoke.html`);
  await new Promise(done => setTimeout(done, Number(values["load-wait"])));
  // The page autofocuses "Start marker"; VoiceOver's cursor follows focus by default, so the load speech should name it.
  const load = await backend.observe();
  await record("page load", undefined, load);
  if (!load.speech.join(" ").includes("Start marker")) console.log("  ! load speech does not name Start marker: the cursor may start elsewhere");

  for (const step of steps) {
    await backend.execute(step.action);
    await record(step.label, step.action, await backend.observe());
  }
  console.log(`\nWrote ${runDir}`);
} finally {
  await backend.close();
  await fixtures.close();
}
