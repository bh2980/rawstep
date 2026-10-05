import { AtDriverClient, AtDriverError, isRecord, positiveMilliseconds, type AtDriverClientOptions, type AtDriverOperationOptions, type AtDriverTransportEvent, type CommandReceipt } from "./transport.js";
import { getAtDriverProfile, type AtDriverAction, type AtDriverCapabilities, type AtDriverProfile, type AtDriverProfileName } from "./profiles.js";
import type { BackendRunContext } from "@rawstep/core/contracts";
import { isLoopbackUrl } from "@rawstep/core/defaults";
import { RawstepError } from "@rawstep/core/errors";

export * from "./transport.js";
export * from "./profiles.js";

export interface AtDriverOutput {
  sequence: number;
  receivedAt: string;
  text: string;
  raw: unknown;
  rawText?: string;
  /** Receipt-time context only. Never a causal command identifier. */
  windowId?: string;
}

export interface AtDriverObservation {
  windowId: string;
  startedAt: string;
  endedAt: string;
  collectionStartedAt: string;
  reason: "quiet" | "deadline";
  outputs: AtDriverOutput[];
  speech: string[];
  /** Attempted commands, including attempts cancelled before physical dispatch. */
  commandIds: number[];
  attribution: "temporal-only";
  speechComplete: "unknown";
}

export interface AtDriverMetadata {
  backend: "at-driver";
  profile: AtDriverProfileName;
  endpoint: string;
  sessionId: string;
  capabilities: AtDriverCapabilities;
  negotiatedCapabilities: Record<string, unknown>;
  environment: {
    atName: string;
    atVersion: string;
    platformName: string;
    platformVersion: "unknown";
    locale: "unknown";
    keyboardLayout: "unknown";
    screenReaderSettings: "unknown";
  };
  assumptions: readonly string[];
  collection: { quietMs: number; maxWaitMs: number; attribution: "temporal-only"; speechCompletionSignal: false };
}

export interface AtDriverReceipt {
  windowId: string;
  commandIds: number[];
  acknowledgedAt: number;
  commands: CommandReceipt[];
}

export type AtDriverEvent = (AtDriverTransportEvent & { windowId?: string }) | {
  type: "windowOpened" | "windowClosed";
  timestamp: number;
  windowId: string;
  observation?: AtDriverObservation;
};

export interface AtDriverBackendOptions extends AtDriverClientOptions {
  profile: AtDriverProfileName;
  quietMs?: number;
  maxWaitMs?: number;
}

type Window = { id: string; startedAt: number; acknowledgedAt: number; commandIds: number[] };

/** AT Driver adapter for the generic runner's backend boundary. */
export class AtDriverBackend {
  readonly evidenceProvenance = 'native' as const;
  readonly capabilities: AtDriverCapabilities;
  private readonly profile: AtDriverProfile;
  private readonly client: AtDriverClient;
  private readonly quietMs: number;
  private readonly maxWaitMs: number;
  private listeners = new Set<(event: AtDriverEvent) => void>();
  private state: "new" | "starting" | "ready" | "closed" = "new";
  private window?: Window;
  private nextWindowId = 1;
  private outputs: AtDriverOutput[] = [];
  private lastOutputAt = 0;
  private busy = false;
  private observationInProgress = false;
  private fatalError?: AtDriverError;
  private observationWake?: () => void;
  private unsubscribe: () => void;

  /** Without a trusted paired session factory, the AT server, OS screen reader and visible browser must share this host. */
  preflight(context: BackendRunContext): void {
    if (context.customBrowserSession) return;
    const host = this.profile.name === "voiceover" ? "darwin" : this.profile.name === "nvda" ? "win32" : undefined;
    if (host && host !== context.platform) throw new RawstepError("backend-precondition", "The native AT server and browser must run on the same supported host. Run RawStep on macOS for VoiceOver or Windows for NVDA.");
    if (this.options.url && !isLoopbackUrl(this.options.url)) throw new RawstepError("backend-precondition", "Default runs require a loopback AT Driver endpoint on the browser host. A remote endpoint needs an explicitly paired browserSessionFactory.");
    if (context.headless) throw new RawstepError("backend-precondition", "Native AT Driver runs require a visible browser; headless is unsupported.");
  }

  constructor(private readonly options: AtDriverBackendOptions) {
    this.profile = getAtDriverProfile(options.profile);
    this.capabilities = this.profile.capabilities;
    this.quietMs = positiveMilliseconds(options.quietMs ?? 500, "quietMs");
    this.maxWaitMs = positiveMilliseconds(options.maxWaitMs ?? 3_000, "maxWaitMs");
    this.client = new AtDriverClient(options);
    this.unsubscribe = this.client.subscribe(event => {
      if (event.type === "command" && this.window && event.commandId !== undefined) {
        this.window.commandIds.push(event.commandId);
      }
      if (event.type === "output") {
        this.lastOutputAt = event.timestamp;
        this.outputs.push({ sequence: event.sequence, receivedAt: new Date(event.timestamp).toISOString(), text: event.text!, raw: event.raw, rawText: event.rawText, ...(this.window ? { windowId: this.window.id } : {}) });
      }
      if ((event.type === "error" && event.commandId === undefined) || event.type === "closed") {
        this.fatalError ??= new AtDriverError(event.error ?? "AT Driver connection closed", "connection closed");
      }
      this.emit({ ...event, ...(this.window ? { windowId: this.window.id } : {}) });
      this.observationWake?.();
    });
  }

  subscribe(listener: (event: AtDriverEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: AtDriverEvent): void {
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* Observer owns its errors. */ }
    }
  }

  private beginWindow(): Window {
    if (!this.window) {
      const now = Date.now();
      this.window = { id: `at-window-${this.nextWindowId++}`, startedAt: now, acknowledgedAt: now, commandIds: [] };
      this.emit({ type: "windowOpened", timestamp: now, windowId: this.window.id });
    }
    return this.window;
  }

  async start(options: AtDriverOperationOptions = {}): Promise<AtDriverMetadata> {
    options.signal?.throwIfAborted();
    if (this.state !== "new") throw new AtDriverError("Backend has already started or closed", "invalid state");
    this.state = "starting";
    const window = this.beginWindow(); // Capture session-start speech, including events before the ACK.
    try {
      await this.client.connect(options);
      const receipt = await this.client.request("session.new", { capabilities: { alwaysMatch: { atName: this.profile.atName } } }, options);
      options.signal?.throwIfAborted();
      const result = receipt.result;
      if (!isRecord(result) || typeof result.sessionId !== "string" || !result.sessionId || !isRecord(result.capabilities)) {
        throw new AtDriverError("Invalid session.new response", "protocol error", receipt.commandId, result);
      }
      if (typeof result.capabilities.atName !== "string" || result.capabilities.atName.toLowerCase() !== this.profile.atName.toLowerCase()) {
        throw new AtDriverError(`Server did not negotiate the requested ${this.profile.atName} profile`, "capability mismatch", receipt.commandId, result);
      }
      window.acknowledgedAt = receipt.acknowledgedAt;
      this.state = "ready";
      const negotiated = result.capabilities;
      const capabilityString = (key: string) => typeof negotiated[key] === "string" && negotiated[key] ? negotiated[key] as string : "unknown";
      return {
        backend: "at-driver", profile: this.profile.name, endpoint: this.options.url, sessionId: result.sessionId,
        capabilities: this.capabilities, negotiatedCapabilities: structuredClone(result.capabilities),
        environment: { atName: capabilityString("atName"), atVersion: capabilityString("atVersion"), platformName: capabilityString("platformName"), platformVersion: "unknown", locale: "unknown", keyboardLayout: "unknown", screenReaderSettings: "unknown" },
        assumptions: this.profile.assumptions,
        collection: { quietMs: this.quietMs, maxWaitMs: this.maxWaitMs, attribution: "temporal-only", speechCompletionSignal: false },
      };
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private assertReady(): void {
    if (this.fatalError) throw this.fatalError;
    if (this.state !== "ready") throw new AtDriverError("AT Driver backend is not ready", "invalid state");
  }

  async execute(action: AtDriverAction, options: AtDriverOperationOptions = {}): Promise<AtDriverReceipt> {
    options.signal?.throwIfAborted();
    this.assertReady();
    if (this.busy || this.observationInProgress) throw new AtDriverError("Concurrent execution/observation is not supported", "invalid state");
    const presses = this.profile.mapAction(action); // Reject unsupported input before mutating the remote end.
    this.busy = true;
    const window = this.beginWindow();
    const commands: CommandReceipt[] = [];
    try {
      options.signal?.throwIfAborted();
      for (const keys of presses) {
        options.signal?.throwIfAborted();
        const receipt = await this.client.request("interaction.userIntent", { name: "pressKeys", keys }, options);
        options.signal?.throwIfAborted();
        // PAC currently serializes its EmptyResult as null; Bocoup uses {}.
        if (receipt.result !== null && (!isRecord(receipt.result) || Object.keys(receipt.result).length > 0)) {
          throw new AtDriverError("Invalid interaction.userIntent acknowledgement", "protocol error", receipt.commandId, receipt.result);
        }
        commands.push(receipt);
        window.acknowledgedAt = receipt.acknowledgedAt;
      }
      return { windowId: window.id, commandIds: commands.map(command => command.commandId), acknowledgedAt: window.acknowledgedAt, commands };
    } catch (error) {
      // An unacknowledged/invalid command may still take effect later. Do not let
      // a subsequent policy step race it or mistake a quiet interval for success.
      if (options.signal?.aborted) {
        // Cancellation cannot retract a keypress already on the wire. End the
        // session so later actions cannot race an unacknowledged partial action.
        await this.close();
      } else if (error instanceof AtDriverError && ["command timeout", "send error", "protocol error"].includes(error.code)) {
        this.fatalError = error;
        await this.close();
      }
      throw error;
    } finally { this.busy = false; }
  }

  async observe({ signal }: AtDriverOperationOptions = {}): Promise<AtDriverObservation> {
    signal?.throwIfAborted();
    this.assertReady();
    if (this.busy || this.observationInProgress) throw new AtDriverError("Concurrent execution/observation is not supported", "invalid state");
    this.observationInProgress = true;
    const window = this.beginWindow();
    // The maximum bounds collection after observe begins, not the duration of a multi-key action.
    // ACK is deliberately not a speech-complete signal; collect for at least quietMs after it.
    const collectionStartedAt = Date.now();
    const deadline = collectionStartedAt + this.maxWaitMs;
    try {
      const reason = await new Promise<"quiet" | "deadline">((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: unknown, result?: "quiet" | "deadline") => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", aborted);
          this.observationWake = undefined;
          if (result) resolve(result); else reject(error);
        };
        const aborted = () => finish(signal!.reason);
        const check = () => {
          clearTimeout(timer);
          if (signal?.aborted) { aborted(); return; }
          if (this.fatalError || this.state === "closed") { finish(this.fatalError ?? new AtDriverError("Backend closed", "connection closed")); return; }
          const now = Date.now();
          const quietAt = Math.max(collectionStartedAt, window.acknowledgedAt, this.lastOutputAt) + this.quietMs;
          if (now >= deadline) { finish(undefined, "deadline"); return; }
          if (now >= quietAt) { finish(undefined, "quiet"); return; }
          timer = setTimeout(check, Math.min(quietAt, deadline) - now);
        };
        signal?.addEventListener("abort", aborted, { once: true });
        this.observationWake = check;
        check();
      });
      signal?.throwIfAborted();
      const observation: AtDriverObservation = {
        windowId: window.id, startedAt: new Date(window.startedAt).toISOString(), endedAt: new Date().toISOString(), reason,
        collectionStartedAt: new Date(collectionStartedAt).toISOString(),
        outputs: this.outputs.splice(0), speech: [], commandIds: [...window.commandIds],
        attribution: "temporal-only", speechComplete: "unknown",
      };
      observation.speech = observation.outputs.map(output => output.text);
      this.window = undefined;
      this.emit({ type: "windowClosed", timestamp: Date.parse(observation.endedAt), windowId: window.id, observation });
      signal?.throwIfAborted();
      return observation;
    } finally { this.observationInProgress = false; }
  }

  async close(): Promise<void> {
    this.state = "closed";
    this.observationWake?.();
    await this.client.close();
    this.unsubscribe();
  }
}
