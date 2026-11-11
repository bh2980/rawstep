import { execFile, spawn } from "node:child_process";
import { AtDriverError } from "./transport.js";

/** A rectangle on the screen, in points from its top left corner. */
export interface ScreenRect { x: number; y: number; width: number; height: number }

/**
 * Where the screen reader's cursor is relative to the page, told by position on the screen rather than by what the reader said, so it
 * holds for any speech language: on the browser's own controls (`outside`), on the web content as a whole (`on`), or on something in
 * the page (`inside`).
 */
export type CursorPlace = "outside" | "on" | "inside";

/** Reads where the screen reader's cursor and the page are on the screen. */
export interface CursorLocator {
  /**
   * The page's area in the browser's front window, when it can be found: the browser with this process ID, or without one the app in
   * front (another app brought forward during the run would then be read instead).
   */
  page(browserProcessId?: number, signal?: AbortSignal): Promise<ScreenRect | undefined>;
  cursor(signal?: AbortSignal): Promise<ScreenRect>;
}

/**
 * The cursor is on the web content when it covers exactly the page's area. Something in the page can come close (a main region one
 * scroll bar narrower), so the edges must match within a point. A region exactly the page's size would be taken for the web content.
 */
export function placeOf(cursor: ScreenRect, page: ScreenRect): CursorPlace {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  if (near(cursor.x, page.x) && near(cursor.y, page.y) && near(cursor.width, page.width) && near(cursor.height, page.height)) return "on";
  const cx = cursor.x + cursor.width / 2, cy = cursor.y + cursor.height / 2;
  return cx >= page.x && cx <= page.x + page.width && cy >= page.y && cy <= page.y + page.height ? "inside" : "outside";
}

/**
 * VoiceOver's cursor from VoiceOver's AppleScript interface, and the page as the largest web area in the browser's front window from
 * macOS accessibility (browser panels such as the address bar's suggestions are smaller web areas of their own), skipping windows that
 * are not standard windows (bubbles). The page is also
 * the browser's front window when the person keeps windows of their own in it: Rawstep brings the run's page to the front.
 */
const VOICEOVER_PLACE_SCRIPT = `function run(argv) {
  const voiceOver = Application("VoiceOver");
  // Addressing an app that is not running starts it: never turn VoiceOver on just to ask where it is.
  if (!voiceOver.running()) throw new Error("VoiceOver is not running.");
  const out = { cursor: voiceOver.voCursor.bounds() };
  if (argv[0] === "page") {
    const processes = Application("System Events").processes;
    const pid = Number(argv[1]);
    // Windows come front to back, and the browser's own bubbles (such as Chrome's "Translate this page?") are windows of their own
    // that can be in front: the page is in the frontmost standard window.
    const windows = (pid > 0 ? processes.whose({ unixId: pid }) : processes.whose({ frontmost: true }))[0].windows();
    const window = windows.find(w => { try { return w.subrole() === "AXStandardWindow"; } catch (e) { return false; } });
    if (!window) return JSON.stringify(out);
    let best = null;
    const visit = (element, depth) => {
      if (depth > 12) return;
      let role; try { role = element.role(); } catch (e) { return; }
      if (role === "AXWebArea") {
        const p = element.position(), s = element.size();
        if (!best || s[0] * s[1] > best.width * best.height) best = { x: p[0], y: p[1], width: s[0], height: s[1] };
        return;
      }
      let children = []; try { children = element.uiElements(); } catch (e) { return; }
      for (let i = 0; i < children.length; i++) visit(children[i], depth + 1);
    };
    visit(window, 0);
    out.page = best;
  }
  return JSON.stringify(out);
}`;

const rect = (value: unknown): ScreenRect | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every(n => typeof n === "number" && Number.isFinite(n)) ? { x, y, width, height } as ScreenRect : undefined;
};

export const VOICEOVER_PLACE_HELP = "Rawstep asks VoiceOver where its cursor is with AppleScript: turn on \"Allow VoiceOver to be controlled with AppleScript\" in VoiceOver Utility › General, and allow the app that runs Rawstep to control VoiceOver and System Events in System Settings › Privacy & Security › Automation. The first time, macOS shows a prompt on screen, and the question waits until someone answers it.";

/**
 * While VoiceOver reads a new page aloud by itself it now and then has no cursor bounds to give (seen on live VoiceOver as one null
 * about every ten reads, the next read fine), so a missing cursor is asked for again before it counts as an answer.
 */
const CURSOR_READS = 5, CURSOR_RETRY_MS = 300;
const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const done = () => { signal?.removeEventListener("abort", stop); resolve(); };
  const timer = setTimeout(done, ms);
  const stop = () => { clearTimeout(timer); reject(signal!.reason); };
  signal?.addEventListener("abort", stop, { once: true });
});

/** `CursorLocator` for VoiceOver on macOS, through `osascript`. */
export function voiceoverCursorLocator(run: (args: string[], signal?: AbortSignal) => Promise<string> = osascript, wait: (ms: number, signal?: AbortSignal) => Promise<void> = pause): CursorLocator {
  const read = async (what: "cursor" | "page", signal?: AbortSignal, browserProcessId?: number) => {
    let parsed: { cursor?: unknown; page?: unknown };
    try { parsed = JSON.parse(await run(["-l", "JavaScript", "-e", VOICEOVER_PLACE_SCRIPT, what, ...(browserProcessId ? [String(browserProcessId)] : [])], signal)); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new AtDriverError(`Could not read where VoiceOver's cursor is: ${(error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/, "")}. ${VOICEOVER_PLACE_HELP}`, "cursor place unknown");
    }
    return parsed;
  };
  return {
    async page(browserProcessId, signal) { return rect((await read("page", signal, browserProcessId)).page); },
    async cursor(signal) {
      for (let i = 1; ; i++) {
        const cursor = rect((await read("cursor", signal)).cursor);
        if (cursor) return cursor;
        if (i >= CURSOR_READS) throw new AtDriverError(`VoiceOver did not say where its cursor is, asked ${CURSOR_READS} times. ${VOICEOVER_PLACE_HELP}`, "cursor place unknown");
        await wait(CURSOR_RETRY_MS, signal);
      }
    },
  };
}

/** Runs one of the screen reader's own commands by name (see `AtDriverProfile.commands`). */
export type ReaderCommander = (command: string, signal?: AbortSignal) => Promise<void>;

export const VOICEOVER_COMMAND_HELP = "Rawstep runs some VoiceOver commands with AppleScript: turn on \"Allow VoiceOver to be controlled with AppleScript\" in VoiceOver Utility › General, and allow the app that runs Rawstep to control VoiceOver in System Settings › Privacy & Security › Automation.";

/** `ReaderCommander` for VoiceOver on macOS: VoiceOver's AppleScript commander, through `osascript`. */
export function voiceoverCommander(run: (args: string[], signal?: AbortSignal) => Promise<string> = osascript): ReaderCommander {
  return async (command, signal) => {
    try {
      await run([
        "-e", "on run argv",
        // Addressing an app that is not running starts it: never turn VoiceOver on just to run a command.
        "-e", "if not (application \"VoiceOver\" is running) then error \"VoiceOver is not running.\"",
        "-e", "tell application \"VoiceOver\" to tell commander to perform command (item 1 of argv)",
        "-e", "end run",
        command,
      ], signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AtDriverError(`VoiceOver did not run "${command}": ${(error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/, "")}. ${VOICEOVER_COMMAND_HELP}`, "command failed");
    }
  };
}

/** Puts text on the system clipboard, for a text action to paste what the keys cannot type (see `AtDriverProfile.pasteText`). */
export type ClipboardWriter = (text: string, signal?: AbortSignal) => Promise<void>;

const PBCOPY_TIMEOUT_MS = 5_000;
/** `ClipboardWriter` for macOS, through `pbcopy`; the text goes in as UTF-8 whatever the process locale. */
export function macClipboard(): ClipboardWriter {
  return (text, signal) => new Promise((resolve, reject) => {
    const child = spawn("pbcopy", [], { env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" }, timeout: PBCOPY_TIMEOUT_MS, signal, stdio: ["pipe", "ignore", "pipe"] });
    let said = "";
    child.stderr.on("data", chunk => { said += String(chunk); });
    child.on("error", error => reject(new AtDriverError(`Could not put the text on the clipboard: ${error.message}`, "clipboard failed")));
    child.on("close", code => code === 0 ? resolve() : reject(new AtDriverError(`Could not put the text on the clipboard: ${said.trim() || `pbcopy exited with ${String(code)}`}`, "clipboard failed")));
    child.stdin.end(text, "utf8");
  });
}

const OSASCRIPT_TIMEOUT_MS = 15_000;
/** Runs osascript. Its own failure message repeats the whole script, so only what osascript said (or that it said nothing) is kept. */
function osascript(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", args, { timeout: OSASCRIPT_TIMEOUT_MS, signal }, (error, stdout, stderr) => {
      if (!error) return resolve(String(stdout));
      const said = String(stderr).trim().split("\n").filter(Boolean).at(-1);
      reject(new Error(said ?? (error.killed ? `osascript got no answer within ${OSASCRIPT_TIMEOUT_MS / 1000} s` : `osascript failed (exit ${String(error.code)})`)));
    });
  });
}
