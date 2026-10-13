/** The Mac side of a collection run: what is installed and running, and the browser that shows the page. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type BrowserName = "safari" | "chrome";
export const browserApps: Record<BrowserName, string> = { safari: "Safari", chrome: "Google Chrome" };

/** stdout of a command, or undefined when it fails. Host facts are best effort: a missing one is recorded as unknown. */
async function output(file: string, args: string[]): Promise<string | undefined> {
  try { return (await run(file, args, { maxBuffer: 16 * 1024 * 1024 })).stdout.trim(); } catch { return undefined; }
}

export async function isVoiceOverRunning(): Promise<boolean> {
  return (await output("pgrep", ["-x", "VoiceOver"])) !== undefined;
}

export interface HostFacts {
  macos: string;
  build: string;
  browser: { name: BrowserName; version: string };
  /** `defaults read` of VoiceOver's settings domains, verbatim. Verbosity, hints, voice and language live here.
   * A domain VoiceOver has not written yet is recorded as unknown, which means its defaults are in effect. */
  voiceOverSettings: { "com.apple.VoiceOver4/default": string; "com.apple.VoiceOverUtility": string };
  locale: string;
}

export async function hostFacts(browser: BrowserName): Promise<HostFacts> {
  const app = `/Applications/${browserApps[browser]}.app/Contents/Info`;
  const [macos, build, version, settings, utility, locale] = await Promise.all([
    output("sw_vers", ["-productVersion"]),
    output("sw_vers", ["-buildVersion"]),
    output("defaults", ["read", app, "CFBundleShortVersionString"]),
    output("defaults", ["read", "com.apple.VoiceOver4/default"]),
    output("defaults", ["read", "com.apple.VoiceOverUtility"]),
    output("defaults", ["read", "-g", "AppleLocale"]),
  ]);
  return {
    macos: macos ?? "unknown", build: build ?? "unknown",
    browser: { name: browser, version: version ?? "unknown" },
    voiceOverSettings: { "com.apple.VoiceOver4/default": settings ?? "unknown", "com.apple.VoiceOverUtility": utility ?? "unknown" },
    locale: locale ?? "unknown",
  };
}

const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

/** Serves one directory on loopback. Pages are opened by URL, so the browser sees an ordinary http page. */
export async function serveDirectory(directory: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const root = resolve(directory);
  const server: Server = createServer(async (request, response) => {
    const path = resolve(root, "." + decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname));
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no port");
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise(done => server.close(() => done())) };
}

/** Opens the URL in the browser and brings it to the front, so VoiceOver reads it. */
export async function openInBrowser(browser: BrowserName, url: string): Promise<void> {
  await run("open", ["-a", browserApps[browser], url]);
  await run("osascript", ["-e", `tell application "${browserApps[browser]}" to activate`]);
}

export async function frontmostApp(): Promise<string | undefined> {
  return output("osascript", ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true']);
}
