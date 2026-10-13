/**
 * Probe a live VoiceOver by hand: optionally open a fixture page, then press each chord in turn and print what was said.
 *   tsx src/probe.ts --page smoke.html VO+Home VO+Right VO+U Right Escape
 *   tsx src/probe.ts --vm vo-collector --page smoke.html VO+Home VO+Right     (VoiceOver in a Tart VM)
 * Chords use session.ts notation. Output is printed only; collection runs write records.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { activateBrowser, atDriverUrl, browserApps, frontmostApp, openInBrowser, requireFrontmost, resolveMachine, serveDirectory, type BrowserName } from "./host.js";
import { spoken, VoSession, type Heard } from "./session.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  vm: { type: "string" },
  url: { type: "string" },
  browser: { type: "string", default: "safari" },
  page: { type: "string" },
  quiet: { type: "string", default: "800" },
  "max-wait": { type: "string", default: "6000" },
} });
const browser = values.browser as BrowserName;
const listen = { quietMs: Number(values.quiet), maxWaitMs: Number(values["max-wait"]) };
const show = (label: string, heard: Heard) =>
  console.log(`${label.padEnd(16)} ${spoken(heard).join(" | ") || "(silence)"}${heard.reason === "deadline" ? "  [still talking]" : ""}`);

const machine = await resolveMachine(values.vm);
const session = new VoSession(values.url ?? atDriverUrl(machine), requireFrontmost(machine, browser));
const fixtures = values.page ? await serveDirectory(join(packageRoot, "fixtures"), machine) : undefined;
try {
  await session.start();
  if (fixtures) {
    await openInBrowser(machine, browser, `${fixtures.origin}/${values.page}`);
    // Auto-read speaks the whole page after load; wait for it to stop, however long that is.
    show("(page load)", await session.listen({ quietMs: 2_000, maxWaitMs: 60_000 }));
  } else await activateBrowser(machine, browser);
  for (const chord of positionals) {
    await session.press(chord);
    show(chord, await session.listen(listen));
  }
  const front = await frontmostApp(machine);
  if (front !== browserApps[browser]) console.log(`! frontmost at end: ${front}`);
} finally {
  await session.close();
  await fixtures?.close();
}
