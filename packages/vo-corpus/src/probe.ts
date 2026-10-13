/**
 * Probe a live VoiceOver by hand: optionally open a fixture page, then press each chord in turn and print what was said.
 *   tsx src/probe.ts --page smoke.html VO+Home VO+Right VO+U Right Escape
 * Chords use session.ts notation. Output is printed only; collection runs write records.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { browserApps, frontmostApp, openInBrowser, serveDirectory, type BrowserName } from "./host.js";
import { spoken, VoSession, type Heard } from "./session.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  url: { type: "string", default: "ws://127.0.0.1:4382/session" },
  browser: { type: "string", default: "safari" },
  page: { type: "string" },
  quiet: { type: "string", default: "800" },
  "max-wait": { type: "string", default: "6000" },
} });
const browser = values.browser as BrowserName;
const listen = { quietMs: Number(values.quiet), maxWaitMs: Number(values["max-wait"]) };
const show = (label: string, heard: Heard) =>
  console.log(`${label.padEnd(16)} ${spoken(heard).join(" | ") || "(silence)"}${heard.reason === "deadline" ? "  [still talking]" : ""}`);

const session = new VoSession(values.url);
const fixtures = values.page ? await serveDirectory(join(packageRoot, "fixtures")) : undefined;
try {
  await session.start();
  if (fixtures) {
    await openInBrowser(browser, `${fixtures.origin}/${values.page}`);
    // Auto-read speaks the whole page after load; wait for it to stop, however long that is.
    show("(page load)", await session.listen({ quietMs: 2_000, maxWaitMs: 60_000 }));
  }
  for (const chord of positionals) {
    await session.press(chord);
    show(chord, await session.listen(listen));
  }
  const front = await frontmostApp();
  if (front !== browserApps[browser]) console.log(`! frontmost at end: ${front}`);
} finally {
  await session.close();
  await fixtures?.close();
}
