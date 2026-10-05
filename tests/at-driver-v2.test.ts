import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtDriverBackend, AtDriverClient, AtDriverError, getAtDriverProfile, KEYS, type AtDriverEvent, type AtDriverTransportEvent, type WebSocketLike } from "@rawstep/screenreaders/at-driver";

class FakeSocket implements WebSocketLike {
  readyState = 1;
  sent: Array<{ id: number; method: string; params: Record<string, any> }> = [];
  listeners = new Map<string, Set<(event: any) => void>>();
  onSend?: (command: FakeSocket["sent"][number]) => void;
  closeCalls = 0;
  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  send(data: string) {
    const command = JSON.parse(data);
    this.sent.push(command);
    this.onSend?.(command);
  }
  close() { this.closeCalls++; this.disconnect(1000); }
  emit(type: string, data: unknown) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(data); }
  reply(id: number, result: unknown = {}) { this.emit("message", { data: JSON.stringify({ id, result }) }); }
  error(id: number | null, error = "unknown command", message = "Not supported") { this.emit("message", { data: JSON.stringify({ id, error, message }) }); }
  output(data: string, extra: Record<string, unknown> = {}) { this.emit("message", { data: JSON.stringify({ method: "interaction.capturedOutput", params: { data, ...extra } }) }); }
  disconnect(code = 1006) { this.readyState = 3; this.emit("close", { code, reason: "test" }); }
  autoRespond() {
    this.onSend = command => {
      if (command.method === "session.new") this.reply(command.id, { sessionId: "test-session", capabilities: { atName: command.params.capabilities.alwaysMatch.atName } });
      else this.reply(command.id);
    };
  }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-30T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

function client(socket = new FakeSocket(), options = {}) {
  return { socket, client: new AtDriverClient({ url: "ws://localhost:3031/session", webSocketFactory: () => socket, commandTimeoutMs: 100, connectTimeoutMs: 100, closeTimeoutMs: 20, ...options }) };
}

async function backend(profile: "voiceover" | "nvda" = "voiceover", options = {}) {
  const socket = new FakeSocket();
  socket.autoRespond();
  const backend = new AtDriverBackend({ url: "ws://localhost:3031/session", profile, webSocketFactory: () => socket, quietMs: 50, maxWaitMs: 200, commandTimeoutMs: 100, ...options });
  const events: AtDriverEvent[] = [];
  backend.subscribe(event => events.push(event));
  const metadata = await backend.start();
  return { socket, backend, events, metadata };
}

async function settle(backend: AtDriverBackend, ms = 50) {
  const observation = backend.observe();
  await vi.advanceTimersByTimeAsync(ms);
  return observation;
}

describe("AT Driver protocol transport", () => {
  it("sends numeric command IDs and correlates responses arriving out of order", async () => {
    const { socket, client: driver } = client();
    await driver.connect();
    const first = driver.request("one", {});
    const second = driver.request("two", {});
    socket.reply(2, { second: true });
    socket.reply(1, { first: true });
    expect((await first).result).toEqual({ first: true });
    expect((await second).result).toEqual({ second: true });
    expect(socket.sent).toEqual([{ id: 1, method: "one", params: {} }, { id: 2, method: "two", params: {} }]);
    await driver.close();
  });

  it("preserves every output in receive order, including duplicates and empty text", async () => {
    const { socket, client: driver } = client();
    const events: AtDriverTransportEvent[] = [];
    driver.subscribe(event => events.push(event));
    await driver.connect();
    socket.output("same", { vendorTimestamp: 30 });
    socket.output("same", { vendorTimestamp: 10 });
    socket.output("");
    const outputs = events.filter(event => event.type === "output");
    expect(outputs.map(event => event.text)).toEqual(["same", "same", ""]);
    expect(outputs.map(event => event.sequence)).toEqual([2, 3, 4]);
    expect(outputs[0]!.raw).toEqual({ method: "interaction.capturedOutput", params: { data: "same", vendorTimestamp: 30 } });
    expect(outputs.every(event => event.commandId === undefined)).toBe(true);
    await driver.close();
  });

  it("reports protocol errors to their own requests without failing others", async () => {
    const { socket, client: driver } = client();
    await driver.connect();
    const first = driver.request("one", {}).catch(error => error);
    const second = driver.request("two", {});
    socket.error(1, "invalid argument", "Bad key");
    socket.reply(2);
    expect(await first).toMatchObject({ code: "invalid argument", commandId: 1, message: "Bad key" });
    await expect(second).resolves.toMatchObject({ commandId: 2 });
    await driver.close();
  });

  it("times out and preserves late/duplicate replies as orphan evidence", async () => {
    const { socket, client: driver } = client();
    const events: AtDriverTransportEvent[] = [];
    driver.subscribe(event => events.push(event));
    await driver.connect();
    const timed = driver.request("slow", {}).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await timed).toMatchObject({ code: "command timeout", commandId: 1 });
    const current = driver.request("current", {});
    socket.reply(1);
    socket.reply(2);
    socket.reply(2);
    expect((await current).commandId).toBe(2);
    expect(events.filter(event => event.type === "orphanResponse").map(event => event.commandId)).toEqual([1, 2]);
    await driver.close();
  });

  it.each(["not json", "[]", "null", '{"id":1}', '{"id":1,"result":{},"error":"oops"}', '{"method":"interaction.capturedOutput","params":{"data":1}}'])
    ("rejects pending work and closes on malformed message %s", async data => {
      const { socket, client: driver } = client();
      await driver.connect();
      const request = driver.request("pending", {}).catch(error => error);
      socket.emit("message", { data });
      expect(await request).toMatchObject({ code: "protocol error" });
      expect(socket.closeCalls).toBe(1);
      await driver.close();
    });

  it("fails all pending requests on an uncorrelatable server error", async () => {
    const { socket, client: driver } = client();
    await driver.connect();
    const one = driver.request("one", {}).catch(error => error);
    const two = driver.request("two", {}).catch(error => error);
    socket.error(null, "unknown error", "Malformed command");
    expect(await one).toMatchObject({ message: "Malformed command" });
    expect(await two).toMatchObject({ message: "Malformed command" });
    await driver.close();
  });

  it("rejects outstanding requests immediately on an unexpected socket close", async () => {
    const { socket, client: driver } = client();
    await driver.connect();
    const request = driver.request("pending", {}).catch(error => error);
    socket.disconnect();
    expect(await request).toMatchObject({ code: "connection closed" });
    await expect(driver.request("after-close", {})).rejects.toBeInstanceOf(AtDriverError);
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("bounds connection attempts and removes their listeners on failure", async () => {
    const socket = new FakeSocket();
    socket.readyState = 0;
    const { client: driver } = client(socket);
    const connecting = driver.connect().catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await connecting).toMatchObject({ code: "connect timeout" });
    expect([...socket.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    await driver.close();
  });

  it("can close while connecting without leaving a hanging request", async () => {
    const socket = new FakeSocket();
    socket.readyState = 0;
    const { client: driver } = client(socket);
    const connecting = driver.connect().catch(error => error);
    await driver.close();
    expect(await connecting).toMatchObject({ code: "connection closed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a broken subscriber strand command correlation", async () => {
    const { socket, client: driver } = client();
    driver.subscribe(() => { throw new Error("observer failed"); });
    socket.onSend = command => socket.reply(command.id);
    await driver.connect();
    await expect(driver.request("one", {})).resolves.toMatchObject({ commandId: 1 });
    await driver.close();
  });

  it("does not emit or send a request whose signal is already aborted", async () => {
    const { socket, client: driver } = client();
    await driver.connect();
    const events: AtDriverTransportEvent[] = [];
    driver.subscribe(event => events.push(event));
    const controller = new AbortController();
    const reason = new Error("run cancelled");
    controller.abort(reason);
    await expect(driver.request("one", {}, { signal: controller.signal })).rejects.toBe(reason);
    expect(socket.sent).toEqual([]);
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("rechecks cancellation after command observers before physically sending", async () => {
    const { socket, client: driver } = client();
    await driver.connect();
    const controller = new AbortController();
    const reason = new Error("trace append failed");
    driver.subscribe(event => {
      if (event.type === "command") {
        controller.abort(reason);
        throw reason;
      }
    });
    await expect(driver.request("one", {}, { signal: controller.signal })).rejects.toBe(reason);
    expect(socket.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
    expect(socket.closeCalls).toBe(1);
  });

  it("cancels only the matching pending request and keeps late replies orphaned", async () => {
    const { socket, client: driver } = client();
    await driver.connect();
    const events: AtDriverTransportEvent[] = [];
    driver.subscribe(event => events.push(event));
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const reason = new Error("run cancelled");
    const cancelled = driver.request("one", {}, { signal: controller.signal }).catch(error => error);
    const current = driver.request("two", {});
    controller.abort(reason);
    expect(await cancelled).toBe(reason);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(1);
    socket.reply(1);
    socket.reply(2);
    expect(await current).toMatchObject({ commandId: 2 });
    expect(events.filter(event => event.type === "orphanResponse").map(event => event.commandId)).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it.each(["response", "timeout", "close", "error", "send error"])("removes request abort listeners after %s", async outcome => {
    const { socket, client: driver } = client();
    await driver.connect();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    if (outcome === "send error") socket.onSend = () => { throw new Error("send failed"); };
    const request = driver.request("one", {}, { signal: controller.signal }).catch(error => error);
    if (outcome === "response") socket.reply(1);
    else if (outcome === "timeout") await vi.advanceTimersByTimeAsync(100);
    else if (outcome === "close") await driver.close();
    else if (outcome === "error") socket.error(null);
    await request;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("cancels connection establishment and cleans up socket and abort listeners", async () => {
    const socket = new FakeSocket();
    socket.readyState = 0;
    const { client: driver } = client(socket);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const reason = new Error("run cancelled");
    const connecting = driver.connect({ signal: controller.signal }).catch(error => error);
    controller.abort(reason);
    expect(await connecting).toBe(reason);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect([...socket.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(socket.closeCalls).toBe(1);
    await driver.close();
  });

  it("avoids constructing a socket for an already cancelled connection", async () => {
    const factory = vi.fn(() => new FakeSocket());
    const driver = new AtDriverClient({ url: "ws://localhost/session", webSocketFactory: factory });
    const controller = new AbortController();
    controller.abort();
    await expect(driver.connect({ signal: controller.signal })).rejects.toBe(controller.signal.reason);
    expect(factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("removes the connection abort listener after opening", async () => {
    const { client: driver } = client();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await driver.connect({ signal: controller.signal });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("preserves the WebSocket error cause for connection diagnostics", async () => {
    const socket = new FakeSocket();
    socket.readyState = 0;
    const { client: driver } = client(socket);
    const connecting = driver.connect().catch(error => error);
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:3031");
    socket.emit("error", { error: cause });
    expect(await connecting).toMatchObject({ code: "connection error", message: expect.stringContaining("ECONNREFUSED"), cause });
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("rejects unsafe endpoint schemes, embedded credentials and invalid timer settings", () => {
    expect(() => client(undefined, { url: "https://example.com" })).toThrow("ws:");
    expect(() => client(undefined, { url: "ws://user:pass@localhost" })).toThrow("credentials");
    expect(() => client(undefined, { commandTimeoutMs: Infinity })).toThrow("positive finite");
  });
});

describe("AT Driver backend", () => {
  it("starts a real session, records unknown environment values, and ends by closing the socket", async () => {
    const { socket, backend: driver, metadata } = await backend();
    expect(socket.sent[0]).toEqual({ id: 1, method: "session.new", params: { capabilities: { alwaysMatch: { atName: "VoiceOver" } } } });
    expect(metadata.environment).toMatchObject({ atName: "VoiceOver", atVersion: "unknown", locale: "unknown", keyboardLayout: "unknown", screenReaderSettings: "unknown" });
    expect(metadata.collection.speechCompletionSignal).toBe(false);
    await driver.close();
    await driver.close();
    expect(socket.sent.some(command => command.method === "session.end")).toBe(false);
    expect(socket.closeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("captures output emitted before the session acknowledgement", async () => {
    const socket = new FakeSocket();
    socket.onSend = command => {
      socket.output("VoiceOver on");
      socket.reply(command.id, { sessionId: "session", capabilities: { atName: "VoiceOver", atVersion: "15", platformName: "macos" } });
    };
    const driver = new AtDriverBackend({ url: "ws://localhost/session", profile: "voiceover", webSocketFactory: () => socket, quietMs: 50 });
    await driver.start();
    expect((await settle(driver)).speech).toEqual(["VoiceOver on"]);
    await driver.close();
  });

  it("does not confuse command ACK with speech completion and collects delayed output", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    socket.onSend = command => {
      socket.output("Before ACK");
      socket.reply(command.id);
      setTimeout(() => socket.output("After ACK"), 40);
      setTimeout(() => socket.output("Last part"), 80);
    };
    const receipt = await driver.execute({ kind: "intent", intent: "next" });
    const done = vi.fn();
    const collected = driver.observe().then(observation => { done(); return observation; });
    await vi.advanceTimersByTimeAsync(120);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    const observation = await collected;
    expect(observation.speech).toEqual(["Before ACK", "After ACK", "Last part"]);
    expect(observation.commandIds).toEqual(receipt.commandIds);
    expect(observation).toMatchObject({ reason: "quiet", attribution: "temporal-only", speechComplete: "unknown" });
    expect(observation.outputs.every(output => !("commandId" in output))).toBe(true);
    expect(typeof observation.outputs[0]!.receivedAt).toBe("string");
    await driver.close();
  });

  it("bounds continuous output by a maximum collection deadline", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    const timer = setInterval(() => socket.output("live region"), 30);
    const observation = driver.observe();
    await vi.advanceTimersByTimeAsync(200);
    expect(await observation).toMatchObject({ reason: "deadline", speechComplete: "unknown" });
    expect((await observation).outputs).toHaveLength(6);
    clearInterval(timer);
    await driver.close();
  });

  it("preserves late/inter-window output without relabeling it as the next action's output", async () => {
    const { socket, backend: driver, events } = await backend();
    const first = await settle(driver);
    socket.output("late unrelated announcement");
    await driver.execute({ kind: "key", key: "Tab" });
    socket.output("new announcement");
    const next = await settle(driver);
    expect(next.windowId).not.toBe(first.windowId);
    expect(first.outputs).toEqual([]);
    expect(next.speech).toEqual(["late unrelated announcement", "new announcement"]);
    expect(next.outputs[0]!.windowId).toBeUndefined();
    expect(next.outputs[1]!.windowId).toBe(next.windowId);
    expect(events.filter(event => event.type === "output")).toHaveLength(2);
    await driver.close();
  });

  it("fails active observation when the socket closes rather than returning false silence", async () => {
    const { socket, backend: driver } = await backend();
    const observed = driver.observe().catch(error => error);
    socket.disconnect();
    expect(await observed).toMatchObject({ code: "connection closed" });
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("rejects overlapping execute/observe operations", async () => {
    const { backend: driver } = await backend();
    const observation = driver.observe();
    await expect(driver.execute({ kind: "key", key: "Tab" })).rejects.toThrow("Concurrent");
    await expect(driver.observe()).rejects.toThrow("Concurrent");
    await vi.advanceTimersByTimeAsync(50);
    await observation;
    await driver.close();
  });

  it.each([null, {}, { sessionId: "session", capabilities: { atName: "NVDA" } }])("cleans up on invalid or mismatched session result %j", async result => {
    const socket = new FakeSocket();
    socket.onSend = command => socket.reply(command.id, result);
    const driver = new AtDriverBackend({ url: "ws://localhost/session", profile: "voiceover", webSocketFactory: () => socket });
    await expect(driver.start()).rejects.toBeInstanceOf(AtDriverError);
    expect(socket.closeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses only supported pressKeys wire commands and accepts the PAC null acknowledgement", async () => {
    const { socket, backend: driver } = await backend("nvda");
    await settle(driver);
    socket.onSend = command => socket.reply(command.id, null);
    await driver.execute({ kind: "intent", intent: "heading.previous" });
    expect(socket.sent.at(-1)).toMatchObject({ method: "interaction.userIntent", params: { name: "pressKeys", keys: [KEYS.Shift, "h"] } });
    await driver.close();
  });

  it("types by ordered per-character keypresses, never as one simultaneous chord", async () => {
    const { socket, backend: driver } = await backend();
    const receipt = await driver.execute({ kind: "replaceText", text: "A@b.co" });
    expect(socket.sent.slice(1).map(command => command.params.keys)).toEqual([
      [KEYS.Meta, "a"], [KEYS.Backspace], [KEYS.Shift, "a"], [KEYS.Shift, "2"], ["b"], ["period"], ["c"], ["o"],
    ]);
    expect(receipt.commandIds).toHaveLength(8);
    await driver.close();
  });

  it("sends no text keys after a trace observer cancels command 2", async () => {
    const { socket, backend: driver } = await backend();
    const controller = new AbortController();
    const reason = new Error("trace append failed");
    driver.subscribe(event => {
      if (event.type === "command" && event.commandId === 2) {
        controller.abort(reason);
        throw reason;
      }
    });
    await expect(driver.execute({ kind: "typeText", text: "ABCDE" }, { signal: controller.signal })).rejects.toBe(reason);
    expect(socket.sent.map(command => command.method)).toEqual(["session.new"]);
    expect(socket.closeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("stops text dispatch when cancelled between an acknowledgement and the next character", async () => {
    const { socket, backend: driver } = await backend();
    const controller = new AbortController();
    const reason = new Error("run budget exceeded");
    socket.onSend = command => {
      socket.reply(command.id);
      controller.abort(reason);
    };
    await expect(driver.execute({ kind: "typeText", text: "ABCDE" }, { signal: controller.signal })).rejects.toBe(reason);
    expect(socket.sent.slice(1).map(command => command.params.keys)).toEqual([[KEYS.Shift, "a"]]);
    expect(socket.closeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await expect(driver.execute({ kind: "key", key: "Tab" })).rejects.toBeInstanceOf(AtDriverError);
  });

  it("cancels an unacknowledged text key without dispatching more characters", async () => {
    const { socket, backend: driver } = await backend();
    const controller = new AbortController();
    const reason = new Error("run cancelled");
    socket.onSend = () => undefined;
    const execution = driver.execute({ kind: "typeText", text: "ABCDE" }, { signal: controller.signal }).catch(error => error);
    controller.abort(reason);
    expect(await execution).toBe(reason);
    expect(socket.sent.slice(1).map(command => command.params.keys)).toEqual([[KEYS.Shift, "a"]]);
    expect(socket.closeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors startup cancellation before sending session.new", async () => {
    const socket = new FakeSocket();
    socket.autoRespond();
    const driver = new AtDriverBackend({ url: "ws://localhost/session", profile: "voiceover", webSocketFactory: () => socket });
    const controller = new AbortController();
    const reason = new Error("trace append failed");
    driver.subscribe(event => { if (event.type === "connected") controller.abort(reason); });
    await expect(driver.start({ signal: controller.signal })).rejects.toBe(reason);
    expect(socket.sent).toEqual([]);
    expect(socket.closeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels observation immediately and removes the quiet timer and abort listener", async () => {
    const { backend: driver } = await backend();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const observed = driver.observe({ signal: controller.signal }).catch(error => error);
    controller.abort(null);
    expect(await observed).toBeNull();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    await expect(settle(driver)).resolves.toMatchObject({ reason: "quiet" });
    await driver.close();
  });

  it("removes observation cancellation listeners after normal collection", async () => {
    const { backend: driver } = await backend();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const observed = driver.observe({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(50);
    await expect(observed).resolves.toMatchObject({ reason: "quiet" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    await driver.close();
  });

  it("prevalidates text before a destructive replace and rejects unsupported actions before wire traffic", async () => {
    const { socket, backend: driver } = await backend("nvda");
    await expect(driver.execute({ kind: "replaceText", text: "alice@example.com" })).rejects.toMatchObject({ code: "unsupported action" });
    await expect(driver.execute({ kind: "intent", intent: "interact" })).rejects.toMatchObject({ code: "unsupported action" });
    await expect(driver.execute({ kind: "intent", intent: "toString" })).rejects.toMatchObject({ code: "unsupported action" });
    await expect(driver.execute({ kind: "key", key: "Meta+Q" })).rejects.toMatchObject({ code: "unsupported action" });
    expect(socket.sent).toHaveLength(1);
    await driver.close();
  });

  it("does not retry a failed partial text action", async () => {
    const { socket, backend: driver } = await backend();
    socket.onSend = command => command.params.keys[0] === "b" ? socket.error(command.id) : socket.reply(command.id);
    await expect(driver.execute({ kind: "typeText", text: "abc" })).rejects.toMatchObject({ code: "unknown command" });
    expect(socket.sent.slice(1).map(command => command.params.keys)).toEqual([["a"], ["b"]]);
    await driver.close();
  });

  it("stops the backend after an unacknowledged action rather than racing a later action", async () => {
    const { socket, backend: driver } = await backend();
    socket.onSend = () => undefined;
    const action = driver.execute({ kind: "key", key: "Tab" }).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await action).toMatchObject({ code: "command timeout" });
    expect(socket.closeCalls).toBe(1);
    await expect(driver.observe()).rejects.toMatchObject({ code: "command timeout" });
    await expect(driver.execute({ kind: "key", key: "Tab" })).rejects.toMatchObject({ code: "command timeout" });
  });

  it("uses explicit, separate profiles and does not advertise NVDA interaction toggles", () => {
    const vo = getAtDriverProfile("voiceover");
    const nvda = getAtDriverProfile("nvda");
    expect(vo.mapAction({ kind: "intent", intent: "next" })).toEqual([[KEYS.Control, KEYS.Alt, KEYS.ArrowRight]]);
    expect(nvda.mapAction({ kind: "intent", intent: "next" })).toEqual([[KEYS.ArrowDown]]);
    expect(vo.capabilities.intents).toContain("interact");
    expect(nvda.capabilities.intents).not.toContain("interact");
    expect(() => vo.mapAction({ kind: "typeText", text: "한글" })).toThrow("unsupported");
    expect(Object.isFrozen(vo.capabilities.intents)).toBe(true);
  });
});

describe('AT Driver host preconditions', () => {
  const make = (url: string, profile: 'voiceover' | 'nvda' = 'voiceover') => new AtDriverBackend({ url, profile, webSocketFactory: () => { throw new Error('preflight must not connect'); } });
  const ok = { platform: 'darwin', headless: false, customBrowserSession: false };
  it('requires the same supported host, a loopback endpoint and a visible browser unless a session factory is paired', () => {
    expect(() => make('ws://localhost/session').preflight(ok)).not.toThrow();
    expect(() => make('ws://localhost/session').preflight({ ...ok, platform: 'win32' })).toThrow(/same supported host/);
    expect(() => make('ws://localhost/session', 'nvda').preflight({ ...ok, platform: 'win32' })).not.toThrow();
    expect(() => make('ws://example.test/session').preflight(ok)).toThrow(expect.objectContaining({ code: 'backend-precondition', message: expect.stringMatching(/loopback AT Driver endpoint/) }));
    expect(() => make('ws://localhost/session').preflight({ ...ok, headless: true })).toThrow(/headless is unsupported/);
    expect(() => make('ws://example.test/session').preflight({ platform: 'linux', headless: true, customBrowserSession: true })).not.toThrow();
  });
});
