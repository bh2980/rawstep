/**
 * The Mac that runs VoiceOver and the browser: this Mac, or a Tart VM driven with `tart exec`. The collector itself always
 * runs on this Mac; it reaches the machine's AT Driver server over the network and serves pages the machine's browser opens.
 */
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

const run = promisify(execFile);

export type BrowserName = "safari" | "chrome";
export const browserApps: Record<BrowserName, string> = { safari: "Safari", chrome: "Google Chrome" };

/** Resuming a capture must retain the original browser and its native evidence profile. */
export function collectionBrowser(requested?:string,captured?:string):BrowserName{
  const browser=requested??captured??'safari';
  if(!Object.hasOwn(browserApps,browser)||captured!==undefined&&!Object.hasOwn(browserApps,captured))throw new Error('Collection browser must be safari or chrome');
  if(captured!==undefined&&browser!==captured)throw new Error('Cannot resume a native capture in a different browser; start a separate run');
  return browser as BrowserName;
}

export interface Machine {
  /** "local", or the Tart VM name. */
  name: string;
  /** Runs a command on the machine and returns stdout. */
  exec(file: string, args: string[]): Promise<string>;
  /** Address of the machine's AT Driver server, as seen from this Mac. */
  atDriverHost: string;
  /** Address of this Mac as seen from the machine's browser: where fixture pages are served. */
  pageHost: string;
  /** Makes a file built on this Mac (a helper binary) available on the machine; returns its path there. */
  place(localPath: string): Promise<string>;
}

export const localMachine: Machine = {
  name: "local",
  exec: async (file, args) => (await run(file, args, { maxBuffer: 16 * 1024 * 1024 })).stdout,
  atDriverHost: "127.0.0.1",
  pageHost: "127.0.0.1",
  place: async localPath => localPath,
};

/** A running Tart VM. Its default route points at this Mac on Tart's NAT network, which is where pages are served. */
export async function tartMachine(vm: string): Promise<Machine> {
  const exec = async (file: string, args: string[]) => (await run("tart", ["exec", vm, "/usr/bin/env", "PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", file, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  const ip = (await run("tart", ["ip", vm])).stdout.trim();
  const route = await exec("route", ["-n", "get", "default"]);
  const gateway = /gateway:\s*(\S+)/.exec(route)?.[1];
  if (!ip || !gateway) throw new Error(`Cannot find the network addresses of VM ${vm} (ip "${ip}", gateway "${gateway}")`);
  const placed = new Map<string, Promise<string>>();
  const place = (localPath: string) => {
    if (!placed.has(localPath)) placed.set(localPath, copyInto(vm, localPath));
    return placed.get(localPath)!;
  };
  return { name: vm, exec, atDriverHost: ip, pageHost: gateway, place };
}

/** Streams a local file into the VM's ~/vo-corpus/bin over `tart exec -i`, once per run. Same CPU and macOS, so binaries run as is. */
async function copyInto(vm: string, localPath: string): Promise<string> {
  const remote = `/Users/admin/vo-corpus/bin/${basename(localPath)}`;
  const temporary=remote+'.upload-'+randomUUID(),quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
  const child = spawn("tart", ["exec", "-i", vm, "sh", "-c", `mkdir -p /Users/admin/vo-corpus/bin && cat > ${quote(temporary)} && chmod +x ${quote(temporary)} && mv ${quote(temporary)} ${quote(remote)}`], { stdio: ["pipe", "ignore", "inherit"] });
  const exited=new Promise<void>((done, fail) => {
    child.on("error", fail);
    child.on("close", code => code === 0 ? done() : fail(new Error(`Copying ${localPath} into ${vm} failed (exit ${code})`)));
  });
  // A stopped guest can close stdin early; pipeline handles EPIPE instead of crashing the collector.
  await Promise.all([pipeline(createReadStream(localPath),child.stdin),exited]);
  return remote;
}

export const atDriverUrl = (machine: Machine, port = 4382) => `ws://${machine.atDriverHost}:${port}/session`;

/** stdout of a command, or undefined when it fails. Facts are best effort: a missing one is recorded as unknown. */
async function output(machine: Machine, file: string, args: string[]): Promise<string | undefined> {
  try { return (await machine.exec(file, args)).trim(); } catch { return undefined; }
}

export async function isVoiceOverRunning(machine: Machine): Promise<boolean> {
  return (await output(machine, "pgrep", ["-x", "VoiceOver"])) !== undefined;
}

export interface MachineFacts {
  machine: string;
  macos: string;
  build: string;
  browser: { name: BrowserName; version: string };
  /** `defaults read` of VoiceOver's settings domains, verbatim. Verbosity, hints, voice and language live here.
   * Unknown is common: recent macOS keeps VoiceOver's settings in a protected group container that `defaults` cannot read,
   * so an unknown here says nothing about whether settings were changed. */
  voiceOverSettings: { "com.apple.VoiceOver4/default": string; "com.apple.VoiceOverUtility": string };
  locale: string;
  languages: string;
  /** Application bundle version, distinct from the AT Driver's reported AT/OS version. */
  voiceOverAppVersion?:string;
  keyboardNavigation?:string;
}

/** Reject mixed capture cohorts; protected/unknown VO preferences still require separate uncertainty reporting. */
export function assertResumeEnvironment(previous: {
  machine: MachineFacts; settings: string; workflowStartProtocol: string; observationProtocol?: string; atDriver: Record<string, unknown>;
}, current: typeof previous) {
  for (const key of ["settings", "workflowStartProtocol", "observationProtocol"] as const) {
    if (!previous[key] || previous[key] !== current[key]) throw new Error(`Cannot resume: ${key} differs or was not recorded; start a separate run`);
  }
  for (const key of ["machine", "macos", "build", "browser", "locale", "languages", "voiceOverAppVersion", "keyboardNavigation"] as const) {
    if (!isDeepStrictEqual(previous.machine[key], current.machine[key])) throw new Error(`Cannot resume: observed environment field ${key} differs; start a separate run`);
  }
  if (!isDeepStrictEqual(previous.atDriver.capabilities, current.atDriver.capabilities)) throw new Error("Cannot resume: negotiated AT capabilities differ; start a separate run");
}

export async function machineFacts(machine: Machine, browser: BrowserName): Promise<MachineFacts> {
  const app = `/Applications/${browserApps[browser]}.app/Contents/Info`;
  const [macos, build, version, settings, utility, locale, languages,voiceOverAppVersion,keyboardNavigation] = await Promise.all([
    output(machine, "sw_vers", ["-productVersion"]),
    output(machine, "sw_vers", ["-buildVersion"]),
    output(machine, "defaults", ["read", app, "CFBundleShortVersionString"]),
    output(machine, "defaults", ["read", "com.apple.VoiceOver4/default"]),
    output(machine, "defaults", ["read", "com.apple.VoiceOverUtility"]),
    output(machine, "defaults", ["read", "-g", "AppleLocale"]),
    output(machine, "defaults", ["read", "-g", "AppleLanguages"]),
    output(machine,'defaults',['read','/System/Library/CoreServices/VoiceOver.app/Contents/Info','CFBundleShortVersionString']),
    output(machine,'defaults',['read','-g','AppleKeyboardUIMode']),
  ]);
  return {
    machine: machine.name, macos: macos ?? "unknown", build: build ?? "unknown",
    browser: { name: browser, version: version ?? "unknown" },
    voiceOverSettings: { "com.apple.VoiceOver4/default": settings ?? "unknown", "com.apple.VoiceOverUtility": utility ?? "unknown" },
    locale: locale ?? "unknown", languages: languages?.replace(/\s+/g, " ") ?? "unknown",
    voiceOverAppVersion:voiceOverAppVersion??'unknown',keyboardNavigation:keyboardNavigation??'unknown',
  };
}

const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

/**
 * Serves one directory to the machine's browser. Binds to the machine's pageHost: loopback for this Mac, Tart's NAT
 * address for a VM, which only VMs on this Mac can reach.
 */
export async function serveDirectory(directory: string, machine: Machine): Promise<{ origin: string; close: () => Promise<void> }> {
  const root = resolve(directory);
  const server: Server = createServer(async (request, response) => {
    const path = resolve(root, "." + decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname));
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, machine.pageHost, done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no port");
  return { origin: `http://${machine.pageHost}:${address.port}`, close: () => new Promise<void>(done => {
    server.close(()=>done());
    // Chrome may leave a speculative socket with no HTTP request; it must not hide a collection error at shutdown.
    server.closeAllConnections();
  }) };
}

/** Opens the URL in the browser and brings it to the front, so VoiceOver reads it. */
export async function openInBrowser(machine: Machine, browser: BrowserName, url: string): Promise<void> {
  await machine.exec("open", ["-a", browserApps[browser], url]);
  await activateBrowser(machine, browser);
}

/**
 * Loads the URL in the browser's current tab (a run visits hundreds of pages; new tabs would pile up), opening a window
 * when there is none, and brings the browser to the front.
 */
export async function navigateBrowser(machine: Machine, browser: BrowserName, url: string): Promise<void> {
  const quoted = JSON.stringify(url);
  const script = browser === "safari"
    ? `tell application "Safari"\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to ${quoted}\nend tell`
    : `tell application "Google Chrome"\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to ${quoted}\nend tell`;
  await machine.exec("osascript", ["-e", script]);
  await activateBrowser(machine, browser);
}

export async function activateBrowser(machine: Machine, browser: BrowserName): Promise<void> {
  await machine.exec("osascript", ["-e", `tell application "${browserApps[browser]}" to activate`]);
}

export async function frontmostApp(machine: Machine): Promise<string | undefined> {
  // System Events can keep Chrome marked frontmost while a UserNotificationCenter permission alert is active.
  return await output(machine,"osascript",["-l","JavaScript","-e",'ObjC.import("AppKit"); ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.localizedName);'])||undefined;
}

/** A beforePress guard: refuses to send keys unless the browser is in front, so nothing else (a system dialog) gets them. */
export function requireFrontmost(machine: Machine, browser: BrowserName): (chord: string) => Promise<void> {
  return async chord => {
    const front = await frontmostApp(machine);
    if (front !== browserApps[browser]) throw new Error(`Stopped before ${chord}: ${front ?? "an unknown app"} is in front of ${machine.name}, not ${browserApps[browser]}. Nothing was pressed.`);
    if (browser === "chrome") {
      const recovery = await machine.exec("osascript", ["-e", 'tell application "System Events" to tell process "Google Chrome" to get exists window "Restore pages?"']);
      if (recovery.trim() === "true") throw new Error(`Stopped before ${chord}: Chrome's Restore pages? recovery window is open. This is an environment failure; nothing was pressed.`);
    }
  };
}

/** --vm <name> selects a Tart VM; without it, this Mac. */
export const resolveMachine = (vm: string | undefined) => vm ? tartMachine(vm) : Promise.resolve(localMachine);
