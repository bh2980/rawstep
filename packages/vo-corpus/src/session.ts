/**
 * A raw VoiceOver session for collection: any key chord in, every utterance out with its receipt time.
 * Rawstep's AtDriverBackend only accepts the intents a model may use; collection needs every VoiceOver command
 * and the exact timing (hints arrive after a delay, auto-read runs long), so it talks to AtDriverClient directly.
 */
import { AT_DRIVER_KEYS, AtDriverClient } from "rawstep/at-driver";

export interface Utterance {
  /** Milliseconds since the session started. */
  t: number;
  text: string;
}

export interface Heard {
  utterances: Utterance[];
  /** quiet: nothing new for quietMs. deadline: still talking at maxWaitMs, so the next listen may get the rest. */
  reason: "quiet" | "deadline";
  startedAt: number;
  endedAt: number;
}

export interface ListenOptions { quietMs?: number; maxWaitMs?: number; minWaitMs?: number }

const named: Record<string, string> = {
  ...AT_DRIVER_KEYS,
  Ctrl: AT_DRIVER_KEYS.Control, Opt: AT_DRIVER_KEYS.Alt, Option: AT_DRIVER_KEYS.Alt, Cmd: AT_DRIVER_KEYS.Meta, Command: AT_DRIVER_KEYS.Meta,
  Left: AT_DRIVER_KEYS.ArrowLeft, Right: AT_DRIVER_KEYS.ArrowRight, Up: AT_DRIVER_KEYS.ArrowUp, Down: AT_DRIVER_KEYS.ArrowDown,
};

/** "VO+Cmd+H" → Control, Option, Command, "h". VO is Control+Option; single characters are lowercase key names. */
export function chordKeys(chord: string): string[] {
  return chord.split("+").flatMap(part => {
    if (part === "VO") return [AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt];
    if (Object.hasOwn(named, part)) return [named[part]!];
    if (part.length === 1) return [part.toLowerCase()];
    throw new Error(`Unknown key "${part}" in chord "${chord}"`);
  });
}

export class VoSession {
  private readonly client: AtDriverClient;
  private readonly origin = Date.now();
  private buffer: Utterance[] = [];
  private lastAt = 0;
  private wake?: () => void;
  private failure?: string;

  /**
   * `beforePress` runs before every chord and throws to stop the session. Collection passes a frontmost-app check:
   * VoiceOver keys go to whatever is in front, and a system dialog (a permission prompt) must never receive them.
   */
  constructor(url: string, private readonly beforePress?: (chord: string) => Promise<void>) {
    this.client = new AtDriverClient({ url, commandTimeoutMs: 15_000 });
    this.client.subscribe(event => {
      if (event.type === "output") {
        this.lastAt = event.timestamp - this.origin;
        this.buffer.push({ t: this.lastAt, text: event.text ?? "" });
      }
      if (event.type === "closed" || (event.type === "error" && event.commandId === undefined)) this.failure ??= event.error ?? "AT Driver connection closed";
      this.wake?.();
    });
  }

  now(): number { return Date.now() - this.origin; }

  async start(): Promise<Record<string, unknown>> {
    await this.client.connect();
    const { result } = await this.client.request("session.new", { capabilities: { alwaysMatch: { atName: "VoiceOver" } } });
    return result as Record<string, unknown>;
  }

  /** Sends one chord. Speech it causes is collected by the next listen(). */
  async press(chord: string): Promise<void> {
    if (this.failure) throw new Error(this.failure);
    await this.beforePress?.(chord);
    await this.client.request("interaction.userIntent", { name: "pressKeys", keys: chordKeys(chord) });
  }

  /** Everything spoken since the last listen, after speech has paused for quietMs (or maxWaitMs passed). */
  async listen({ quietMs = 800, maxWaitMs = 6_000, minWaitMs = 0 }: ListenOptions = {}): Promise<Heard> {
    if (![quietMs, maxWaitMs, minWaitMs].every(Number.isFinite) || quietMs < 0 || minWaitMs < 0 || maxWaitMs <= 0 || minWaitMs > maxWaitMs) {
      throw new Error("Invalid listen window: nonnegative finite quiet/minimum times and a positive deadline >= minimum are required");
    }
    const startedAt = this.now(), deadline = startedAt + maxWaitMs;
    const reason = await new Promise<"quiet" | "deadline">((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = () => {
        clearTimeout(timer);
        if (this.failure) { this.wake = undefined; reject(new Error(this.failure)); return; }
        const now = this.now(), quietAt = Math.max(startedAt + minWaitMs, Math.max(startedAt, this.lastAt) + quietMs);
        if (now >= deadline || now >= quietAt) { this.wake = undefined; resolve(now >= quietAt ? "quiet" : "deadline"); return; }
        timer = setTimeout(check, Math.min(quietAt, deadline) - now);
      };
      this.wake = check;
      check();
    });
    return { utterances: this.buffer.splice(0), reason, startedAt, endedAt: this.now() };
  }

  /** Discards whatever is buffered: speech from before a reset must not land in the next case. */
  drain(): void { this.buffer = []; }

  /** Receipts arriving during a read-only AX dump still belong to the action preceding that dump. */
  takeBuffered(): Utterance[] { return this.buffer.splice(0); }

  close(): Promise<void> { return this.client.close(); }
}

export const spoken = (heard: Heard) => heard.utterances.map(u => u.text.trim()).filter(Boolean);
