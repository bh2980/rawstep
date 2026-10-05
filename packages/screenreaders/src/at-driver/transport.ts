/** Minimal AT Driver wire client. No browser, policy, or screen-reader semantics. */
import { isRecord, positiveMilliseconds } from "../internal/guards.js";
export interface WebSocketLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;
export type AtDriverTransportEvent = {
  /** "command" journals an attempt before dispatch (backend.command in a run
   * trace). A later subscriber can cancel its send, so this event alone proves
   * neither physical dispatch nor native effect. "response" is separate ACK/error evidence. */
  type: "connected" | "command" | "response" | "output" | "event" | "orphanResponse" | "error" | "closed";
  sequence: number;
  timestamp: number;
  raw?: unknown;
  rawText?: string;
  commandId?: number;
  method?: string;
  text?: string;
  error?: string;
};

export interface CommandReceipt {
  commandId: number;
  sentAt: number;
  acknowledgedAt: number;
  result: unknown;
}

export class AtDriverError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly commandId?: number,
    public readonly raw?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AtDriverError";
  }
}

export interface AtDriverClientOptions {
  url: string;
  webSocketFactory?: WebSocketFactory;
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  closeTimeoutMs?: number;
}

export interface AtDriverOperationOptions {
  signal?: AbortSignal;
}

type Pending = {
  sentAt: number;
  cleanup: () => void;
  resolve: (receipt: CommandReceipt) => void;
  reject: (error: unknown) => void;
};

export class AtDriverClient {
  private socket?: WebSocketLike;
  private state: "new" | "connecting" | "open" | "closing" | "closed" = "new";
  private nextId = 1;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: AtDriverTransportEvent) => void>();
  private connectFailure?: (error: AtDriverError) => void;
  private closePromise?: Promise<void>;
  private failure?: AtDriverError;
  private readonly commandTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly closeTimeoutMs: number;

  constructor(private readonly options: AtDriverClientOptions) {
    const parsed = new URL(options.url);
    if (!["ws:", "wss:"].includes(parsed.protocol)) throw new Error("AT Driver endpoint must use ws: or wss:");
    if (parsed.username || parsed.password) throw new Error("AT Driver endpoint must not contain credentials");
    this.commandTimeoutMs = positiveMilliseconds(options.commandTimeoutMs ?? 10_000, "commandTimeoutMs");
    this.connectTimeoutMs = positiveMilliseconds(options.connectTimeoutMs ?? 10_000, "connectTimeoutMs");
    this.closeTimeoutMs = positiveMilliseconds(options.closeTimeoutMs ?? 1_000, "closeTimeoutMs");
  }

  subscribe(listener: (event: AtDriverTransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: Omit<AtDriverTransportEvent, "sequence" | "timestamp">): void {
    const record = { ...event, sequence: ++this.sequence, timestamp: Date.now() };
    // An observer must not interrupt response correlation or strand request timers.
    for (const listener of this.listeners) {
      try { listener(structuredClone(record)); } catch { /* Observer owns its errors. */ }
    }
  }

  async connect({ signal }: AtDriverOperationOptions = {}): Promise<void> {
    signal?.throwIfAborted();
    if (this.state !== "new") throw new AtDriverError("AT Driver client cannot be reconnected", "invalid state");
    this.state = "connecting";
    try {
      const factory = this.options.webSocketFactory ?? ((url: string) => {
        if (typeof globalThis.WebSocket !== "function") throw new Error("This runtime needs a native WebSocket (Node.js 22 or later)");
        return new globalThis.WebSocket(url);
      });
      this.socket = factory(this.options.url);
      this.socket.addEventListener("message", this.onMessage);
      this.socket.addEventListener("close", this.onClose);
      this.socket.addEventListener("error", this.onError);
      await new Promise<void>((resolve, reject) => {
        const socket = this.socket!;
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeEventListener("open", opened);
          signal?.removeEventListener("abort", aborted);
          this.connectFailure = undefined;
        };
        const aborted = () => { cleanup(); reject(signal!.reason); };
        const opened = () => {
          if (this.state !== "connecting") return;
          cleanup();
          this.state = "open";
          this.emit({ type: "connected" });
          if (signal?.aborted) { reject(signal.reason); return; }
          resolve();
        };
        const timer = setTimeout(() => {
          this.fail(new AtDriverError("AT Driver connection timed out", "connect timeout"));
          this.closeSocket();
        }, this.connectTimeoutMs);
        this.connectFailure = error => { cleanup(); reject(error); };
        socket.addEventListener("open", opened);
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) aborted();
        else if (socket.readyState === 1) opened();
        else if (socket.readyState > 1) this.fail(new AtDriverError("AT Driver socket closed before connecting", "connection closed"));
      });
      signal?.throwIfAborted();
    } catch (error) {
      if (signal?.aborted) {
        await this.close();
        throw signal.reason;
      }
      this.fail(error instanceof AtDriverError ? error : new AtDriverError(String(error), "connection error"));
      this.closeSocket();
      throw this.failure;
    }
  }

  request(method: string, params: Record<string, unknown>, { signal }: AtDriverOperationOptions = {}): Promise<CommandReceipt> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.state !== "open" || this.socket?.readyState !== 1) {
      return Promise.reject(this.failure ?? new AtDriverError("AT Driver socket is not open", "connection closed"));
    }
    const commandId = this.nextId++;
    const raw = { id: commandId, method, params };
    const rawText = JSON.stringify(raw);
    const sentAt = Date.now();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.pending.delete(commandId);
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
      };
      const aborted = () => {
        if (!this.pending.has(commandId)) return;
        cleanup();
        reject(signal!.reason);
      };
      const timer = setTimeout(() => {
        cleanup();
        const error = new AtDriverError(`AT Driver command ${commandId} (${method}) timed out`, "command timeout", commandId);
        this.emit({ type: "error", commandId, method, error: error.message });
        reject(error);
      }, this.commandTimeoutMs);
      this.pending.set(commandId, { sentAt, cleanup, resolve, reject });
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      this.emit({ type: "command", raw, rawText, commandId, method });
      // Recording the command may synchronously cancel the operation. Never
      // send a physical keypress after its observer has reported a failure.
      if (signal?.aborted) { aborted(); return; }
      if (!this.pending.has(commandId)) return; // An observer may also close the client.
      try { this.socket!.send(rawText); }
      catch (error) {
        cleanup();
        const failure = new AtDriverError(`AT Driver send failed: ${String(error)}`, "send error", commandId);
        this.emit({ type: "error", commandId, method, error: failure.message });
        reject(failure);
      }
    });
  }

  private onMessage = (event: { data: unknown }): void => {
    if (this.state === "closed") return;
    let raw: unknown;
    const rawText = typeof event.data === "string" ? event.data : undefined;
    try {
      if (rawText === undefined) throw new Error("Expected a JSON text WebSocket frame");
      raw = JSON.parse(rawText);
      if (!isRecord(raw)) throw new Error("Expected an AT Driver message object");
      if (Object.hasOwn(raw, "id")) {
        const id = raw.id;
        if (id === null && typeof raw.error === "string") {
          this.fail(new AtDriverError(String(raw.message ?? raw.error), raw.error, undefined, raw), rawText);
          this.closeSocket();
          return;
        }
        if (!Number.isSafeInteger(id) || (id as number) < 0) throw new Error("Invalid AT Driver response id");
        const commandId = id as number;
        const hasResult = Object.hasOwn(raw, "result");
        const hasError = typeof raw.error === "string";
        if (hasResult === hasError) throw new Error("Response must have exactly one of result or error");
        const pending = this.pending.get(commandId);
        this.emit({ type: pending ? "response" : "orphanResponse", commandId, raw, rawText });
        if (!pending) return; // Late/duplicate responses never satisfy another request.
        pending.cleanup();
        if (hasError) pending.reject(new AtDriverError(String(raw.message ?? raw.error), raw.error as string, commandId, raw));
        else pending.resolve({ commandId, sentAt: pending.sentAt, acknowledgedAt: Date.now(), result: raw.result });
      } else if (typeof raw.method === "string" && isRecord(raw.params)) {
        if (raw.method === "interaction.capturedOutput") {
          if (typeof raw.params.data !== "string") throw new Error("capturedOutput.params.data must be a string");
          this.emit({ type: "output", method: raw.method, text: raw.params.data, raw, rawText });
        } else {
          this.emit({ type: "event", method: raw.method, raw, rawText });
        }
      } else throw new Error("Unrecognized AT Driver message envelope");
    } catch (error) {
      this.fail(new AtDriverError(`Invalid AT Driver message: ${String(error)}`, "protocol error", undefined, raw ?? event.data), rawText);
      this.closeSocket();
    }
  };

  private onClose = (event: { code?: number; reason?: string }): void => {
    const expected = this.state === "closing";
    if (!expected) this.fail(new AtDriverError(`AT Driver connection closed (${event.code ?? "unknown"}): ${event.reason ?? ""}`, "connection closed"));
    this.state = "closed";
    this.emit({ type: "closed", raw: { code: event.code, reason: event.reason, expected } });
    this.detach();
  };

  private onError = (event: { error?: unknown; message?: unknown } = {}): void => {
    const cause = event.error;
    const detail = cause instanceof Error ? cause.message : typeof event.message === "string" ? event.message : typeof cause === "string" ? cause : undefined;
    const message = detail ? `AT Driver WebSocket connection error: ${detail.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300)}` : "AT Driver WebSocket connection error";
    this.fail(new AtDriverError(message, "connection error", undefined, undefined, cause === undefined ? undefined : { cause }));
    this.closeSocket();
  };

  private fail(error: AtDriverError, rawText?: string): void {
    if (this.failure) return;
    this.failure = error;
    this.emit({ type: "error", error: error.message, raw: error.raw, rawText });
    this.connectFailure?.(error);
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    if (this.state !== "closing") this.state = "closed";
  }

  private closeSocket(): void {
    try { this.socket?.close(1000, "AT Driver session ended"); } catch { /* Already gone. */ }
  }

  private detach(): void {
    this.socket?.removeEventListener("message", this.onMessage);
    this.socket?.removeEventListener("close", this.onClose);
    this.socket?.removeEventListener("error", this.onError);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    // AT Driver sessions end by closing their WebSocket. There is no session.end command.
    const error = new AtDriverError("AT Driver client closed", "connection closed");
    this.connectFailure?.(error);
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
    this.state = "closing";
    this.closePromise = new Promise(resolve => {
      const socket = this.socket;
      const finish = () => {
        clearTimeout(timer);
        socket?.removeEventListener("close", finish);
        this.detach();
        this.state = "closed";
        resolve();
      };
      const timer = setTimeout(finish, this.closeTimeoutMs);
      if (!socket || socket.readyState === 3) { finish(); return; }
      socket.addEventListener("close", finish);
      this.closeSocket();
    });
    return this.closePromise;
  }
}
