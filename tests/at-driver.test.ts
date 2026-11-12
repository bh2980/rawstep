import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtDriverBackend, AtDriverClient, AtDriverError, getAtDriverProfile, placeOf, voiceoverCursorLocator, voiceoverCommander, checkVoiceOverPlace, macClipboard, OsascriptTimeout, AT_DRIVER_KEYS, type AtDriverEvent, type AtDriverTransportEvent, type CursorLocator, type WebSocketLike } from "@rawstep/screenreaders/at-driver";

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
    expect(socket.sent.at(-1)).toMatchObject({ method: "interaction.userIntent", params: { name: "pressKeys", keys: [AT_DRIVER_KEYS.Shift, "h"] } });
    await driver.close();
  });

  it("lists headings on VoiceOver through the rotor: opens it, finds the Headings list by ear, reads to the end and closes it", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    const key = (keys: string[]) => keys.join("+");
    const said: Record<string, string[]> = { [key([AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt, "u"])]: ["Links"], [key([AT_DRIVER_KEYS.ArrowRight])]: ["Headings"], [key([AT_DRIVER_KEYS.Escape])]: [] };
    // The rotor wraps to the first heading at the end; "Learn more" is two different headings, not the end of the list.
    const headings = ["Shop, heading level 1", "Learn more, heading level 2", "Products, heading level 2", "Learn more, heading level 2"];
    let at = 0;
    socket.onSend = command => {
      socket.reply(command.id);
      const keys = command.params.keys as string[];
      const speech = key(keys) === key([AT_DRIVER_KEYS.ArrowDown]) ? [headings[at++ % headings.length]!] : said[key(keys)] ?? [];
      for (const text of speech) if (text) socket.output(text);
    };
    const action = driver.execute({ kind: "intent", intent: "headings.list" });
    await vi.advanceTimersByTimeAsync(10_000);
    await action;
    const down = [AT_DRIVER_KEYS.ArrowDown];
    expect(socket.sent.slice(-9).map(command => command.params.keys)).toEqual([
      [AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt, "u"], [AT_DRIVER_KEYS.ArrowRight], down, down, down, down, down, down, [AT_DRIVER_KEYS.Escape],
    ]);
    const observation = await settle(driver);
    expect(observation.speech).toEqual(["Links", "Headings", ...headings, "Shop, heading level 1", "Learn more, heading level 2"]);
    expect(getAtDriverProfile("voiceover").capabilities.intents).toContain("headings.list");
    expect(getAtDriverProfile("nvda").capabilities.intents).not.toContain("headings.list");
    await driver.close();
  });

  it("ends the headings list when the rotor stays on its last heading", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    const headings = ["Shop, heading level 1", "Products, heading level 2"];
    let at = 0;
    socket.onSend = command => {
      socket.reply(command.id);
      const keys = command.params.keys as string[];
      if (keys.includes("u")) socket.output("Headings");
      else if (keys[0] === AT_DRIVER_KEYS.ArrowDown) socket.output(headings[Math.min(at++, headings.length - 1)]!);
    };
    const action = driver.execute({ kind: "intent", intent: "headings.list" });
    await vi.advanceTimersByTimeAsync(5_000);
    await action;
    const keys = socket.sent.slice(1).map(command => command.params.keys as string[]);
    expect(keys.filter(k => k[0] === AT_DRIVER_KEYS.ArrowDown)).toHaveLength(4);
    expect(keys.at(-1)).toEqual([AT_DRIVER_KEYS.Escape]);
    await driver.close();
  });

  it("finds the headings list when Korean VoiceOver names it 머리말", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    const headings = ["쇼핑, 머리말 수준 1", "상품, 머리말 수준 2"];
    let at = 0;
    socket.onSend = command => {
      socket.reply(command.id);
      const keys = command.params.keys as string[];
      if (keys.includes("u")) socket.output("링크");
      else if (keys[0] === AT_DRIVER_KEYS.ArrowRight) socket.output("머리말");
      else if (keys[0] === AT_DRIVER_KEYS.ArrowDown) socket.output(headings[Math.min(at++, headings.length - 1)]!);
    };
    const action = driver.execute({ kind: "intent", intent: "headings.list" });
    await vi.advanceTimersByTimeAsync(5_000);
    await action;
    const keys = socket.sent.slice(1).map(command => command.params.keys as string[]);
    expect(keys.filter(k => k.length === 1 && k[0] === AT_DRIVER_KEYS.ArrowRight)).toHaveLength(1);
    expect(keys.some(k => k[0] === AT_DRIVER_KEYS.ArrowDown)).toBe(true);
    await driver.close();
  });

  it("closes the rotor without reading when no Headings list is found", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    socket.onSend = command => { socket.reply(command.id); if ((command.params.keys as string[]).includes("u")) socket.output("Links"); };
    const action = driver.execute({ kind: "intent", intent: "headings.list" });
    await vi.advanceTimersByTimeAsync(10_000);
    await action;
    const keys = socket.sent.slice(1).map(command => command.params.keys as string[]);
    expect(keys.filter(k => k.length === 1 && k[0] === AT_DRIVER_KEYS.ArrowRight)).toHaveLength(12);
    expect(keys.some(k => k[0] === AT_DRIVER_KEYS.ArrowDown)).toBe(false);
    expect(keys.at(-1)).toEqual([AT_DRIVER_KEYS.Escape]);
    await driver.close();
  });

  it("lists links on VoiceOver through the rotor, passing a list whose item only mentions links", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    const links = ["Home, link", "Cart, link"];
    let at = 0, rights = 0;
    socket.onSend = command => {
      socket.reply(command.id);
      const keys = command.params.keys as string[];
      if (keys.includes("u")) socket.output("Headings");
      else if (keys.length === 1 && keys[0] === AT_DRIVER_KEYS.ArrowRight) socket.output(++rights === 1 ? "Quick links, heading level 2" : "Links");
      else if (keys[0] === AT_DRIVER_KEYS.ArrowDown) socket.output(links[Math.min(at++, links.length - 1)]!);
    };
    const action = driver.execute({ kind: "intent", intent: "links.list" });
    await vi.advanceTimersByTimeAsync(5_000);
    await action;
    const keys = socket.sent.slice(1).map(command => command.params.keys as string[]);
    expect(keys.filter(k => k.length === 1 && k[0] === AT_DRIVER_KEYS.ArrowRight)).toHaveLength(2);
    expect(keys.filter(k => k[0] === AT_DRIVER_KEYS.ArrowDown)).toHaveLength(4);
    expect(keys.at(-1)).toEqual([AT_DRIVER_KEYS.Escape]);
    expect((await settle(driver)).speech).toEqual(["Headings", "Quick links, heading level 2", "Links", ...links, "Cart, link", "Cart, link"]);
    await driver.close();
  });

  it("opens the VoiceOver rotor on Form Controls and leaves it open: Down/Up move, Return picks and closes it", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    socket.onSend = command => {
      socket.reply(command.id);
      const keys = command.params.keys as string[];
      if (keys.includes("u")) socket.output("Headings");
      else if (keys.length === 1 && keys[0] === AT_DRIVER_KEYS.ArrowRight) socket.output("Form Controls");
    };
    const sentKeys = () => socket.sent.slice(1).map(command => command.params.keys as string[]);
    const run = async (action: Parameters<AtDriverBackend["execute"]>[0]) => {
      const from = sentKeys().length;
      const done = driver.execute(action);
      await vi.advanceTimersByTimeAsync(5_000);
      await done;
      await settle(driver);
      return sentKeys().slice(from);
    };
    const vo = [AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt];
    expect(await run({ kind: "intent", intent: "formControls.rotor" })).toEqual([[...vo, "u"], [AT_DRIVER_KEYS.ArrowRight]]);
    expect(await run({ kind: "intent", intent: "next" })).toEqual([[AT_DRIVER_KEYS.ArrowDown]]);
    expect(await run({ kind: "intent", intent: "previous" })).toEqual([[AT_DRIVER_KEYS.ArrowUp]]);
    expect(await run({ kind: "intent", intent: "activate" })).toEqual([[AT_DRIVER_KEYS.Enter]]);
    expect(await run({ kind: "intent", intent: "next" })).toEqual([[...vo, AT_DRIVER_KEYS.ArrowRight]]);
    // Picking from the list goes to the item and presses nothing on the page: the receipt says so. With no list open, activate is a press.
    await run({ kind: "intent", intent: "formControls.rotor" });
    const picking = driver.execute({ kind: "intent", intent: "activate" }); await vi.advanceTimersByTimeAsync(5_000);
    expect(await picking).toMatchObject({ pressed: false });
    await settle(driver);
    const pressing = driver.execute({ kind: "intent", intent: "activate" }); await vi.advanceTimersByTimeAsync(5_000);
    expect(await pressing).not.toHaveProperty("pressed");
    await settle(driver);
    expect(getAtDriverProfile("voiceover").capabilities.intents).toEqual(expect.arrayContaining(["links.list", "formControls.rotor"]));
    expect(getAtDriverProfile("nvda").capabilities.intents).not.toEqual(expect.arrayContaining(["formControls.rotor"]));
    await driver.close();
  });

  it("closes an open VoiceOver rotor before any other action, and Escape only closes it", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    socket.onSend = command => { socket.reply(command.id); if ((command.params.keys as string[]).includes("u")) socket.output("양식 컨트롤"); };
    const sentKeys = () => socket.sent.slice(1).map(command => command.params.keys as string[]);
    const run = async (action: Parameters<AtDriverBackend["execute"]>[0]) => {
      const from = sentKeys().length;
      const done = driver.execute(action);
      await vi.advanceTimersByTimeAsync(5_000);
      await done;
      await settle(driver);
      return sentKeys().slice(from);
    };
    const vo = [AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt];
    expect(await run({ kind: "intent", intent: "formControls.rotor" })).toEqual([[...vo, "u"]]);
    expect(await run({ kind: "intent", intent: "heading.next" })).toEqual([[AT_DRIVER_KEYS.Escape], [...vo, AT_DRIVER_KEYS.Meta, "h"]]);
    await run({ kind: "intent", intent: "formControls.rotor" });
    expect(await run({ kind: "key", key: "Escape" })).toEqual([[AT_DRIVER_KEYS.Escape]]);
    expect(await run({ kind: "key", key: "Escape" })).toEqual([[AT_DRIVER_KEYS.Escape]]);
    expect(await run({ kind: "intent", intent: "next" })).toEqual([[...vo, AT_DRIVER_KEYS.ArrowRight]]);
    await driver.close();
  });

  it("closes a rotor list left open when the run ends, so the next run's reader starts where its backend believes it is", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    socket.onSend = command => { socket.reply(command.id); if ((command.params.keys as string[]).includes("u")) socket.output("Form Controls"); };
    const opened = driver.execute({ kind: "intent", intent: "formControls.rotor" });
    await vi.advanceTimersByTimeAsync(5_000); await opened;
    await settle(driver);
    await driver.close();
    expect(socket.sent.at(-1)!.params.keys).toEqual([AT_DRIVER_KEYS.Escape]);
    expect(socket.closeCalls).toBe(1);
    // With no rotor open, closing presses nothing.
    const { socket: quiet, backend: plain } = await backend();
    await settle(plain);
    await plain.close();
    expect(quiet.sent).toHaveLength(1);
  });

  it("moves back by heading, control or link on VoiceOver through its own commands, not keys, closing an open rotor first", async () => {
    const commands: string[] = [];
    const { socket, backend: driver, events } = await backend("voiceover", { commander: async (command: string) => { commands.push(command); socket.output(`${command} done`); } });
    await settle(driver);
    socket.onSend = command => { socket.reply(command.id); if ((command.params.keys as string[]).includes("u")) socket.output("Form Controls"); };
    const sentKeys = () => socket.sent.slice(1).map(command => command.params.keys as string[]);
    const run = async (action: Parameters<AtDriverBackend["execute"]>[0]) => {
      const from = sentKeys().length;
      const done = driver.execute(action);
      await vi.advanceTimersByTimeAsync(5_000);
      const receipt = await done;
      return { keys: sentKeys().slice(from), receipt, observation: await settle(driver) };
    };
    for (const intent of ["heading.previous", "form.previous", "link.previous"]) {
      const { keys, receipt, observation } = await run({ kind: "intent", intent });
      expect(keys).toEqual([]);
      expect(receipt.commandIds).toEqual([]);
      expect(observation.speech.at(-1)).toMatch(/ done$/);
    }
    expect(commands).toEqual(["find previous heading", "find previous control", "find previous link"]);
    expect(events.filter(e => e.type === "readerCommand").map(e => e.type === "readerCommand" && `${e.stage} ${e.command}`).slice(0, 2)).toEqual(["sent find previous heading", "done find previous heading"]);
    await run({ kind: "intent", intent: "formControls.rotor" });
    expect((await run({ kind: "intent", intent: "heading.previous" })).keys).toEqual([[AT_DRIVER_KEYS.Escape]]);
    expect(commands.at(-1)).toBe("find previous heading");
    await driver.close();
  });

  it("runs VoiceOver commands through osascript by name and explains a failure", async () => {
    const calls: string[][] = [];
    await voiceoverCommander(async args => { calls.push(args); return ""; })("find previous link");
    expect(calls[0]!.at(-1)).toBe("find previous link");
    expect(calls[0]!.join(" ")).toContain("perform command (item 1 of argv)");
    await expect(voiceoverCommander(async () => { throw new Error("Not authorized to send Apple events to VoiceOver."); })("find previous link"))
      .rejects.toThrow(/VoiceOver did not run "find previous link": Not authorized.*Allow VoiceOver to be controlled with AppleScript/);
    await expect(voiceoverCommander(async () => { throw new Error("Not authorized to send Apple events to VoiceOver."); })("find previous link")).rejects.toMatchObject({ code: "command failed" });
    await expect(voiceoverCommander(async () => { throw new OsascriptTimeout("osascript got no answer within 15 s"); })("find previous link")).rejects.toMatchObject({ code: "command timeout" });
  });

  it("ends the session when a VoiceOver command got no answer in time, since it can still happen later, and goes on after one that was refused", async () => {
    const refused = await backend("voiceover", { commander: voiceoverCommander(async () => { throw new Error("Not authorized to send Apple events to VoiceOver."); }) });
    await expect(refused.backend.execute({ kind: "intent", intent: "link.previous" })).rejects.toMatchObject({ code: "command failed" });
    await refused.backend.execute({ kind: "intent", intent: "next" });
    await refused.backend.close();
    const late = await backend("voiceover", { commander: voiceoverCommander(async () => { throw new OsascriptTimeout("osascript got no answer within 15 s"); }) });
    await expect(late.backend.execute({ kind: "intent", intent: "link.previous" })).rejects.toMatchObject({ code: "command timeout" });
    await expect(late.backend.execute({ kind: "intent", intent: "next" })).rejects.toMatchObject({ code: "command timeout" });
  });

  it("closes the rotor when no Form Controls list is found, so next moves the VoiceOver cursor again", async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    socket.onSend = command => { socket.reply(command.id); if ((command.params.keys as string[]).includes("u")) socket.output("Links"); };
    const action = driver.execute({ kind: "intent", intent: "formControls.rotor" });
    await vi.advanceTimersByTimeAsync(10_000);
    await action;
    const keys = socket.sent.slice(1).map(command => command.params.keys as string[]);
    expect(keys.filter(k => k.length === 1 && k[0] === AT_DRIVER_KEYS.ArrowRight)).toHaveLength(12);
    expect(keys.at(-1)).toEqual([AT_DRIVER_KEYS.Escape]);
    await settle(driver);
    await driver.execute({ kind: "intent", intent: "next" });
    expect(socket.sent.at(-1)!.params.keys).toEqual([AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt, AT_DRIVER_KEYS.ArrowRight]);
    await driver.close();
  });

  it("types by ordered per-character keypresses, never as one simultaneous chord", async () => {
    const { socket, backend: driver } = await backend();
    const receipt = await driver.execute({ kind: "replaceText", text: "A@b.co" });
    expect(socket.sent.slice(1).map(command => command.params.keys)).toEqual([
      [AT_DRIVER_KEYS.Meta, "a"], [AT_DRIVER_KEYS.Backspace], [AT_DRIVER_KEYS.Shift, "a"], [AT_DRIVER_KEYS.Shift, "2"], ["b"], ["period"], ["c"], ["o"],
    ]);
    expect(receipt.commandIds).toHaveLength(8);
    await driver.close();
  });

  it("pastes text VoiceOver's keys cannot type, putting it on the clipboard before any key, and still types ASCII key by key", async () => {
    const order: string[] = [];
    const { socket, backend: driver, events } = await backend("voiceover", { clipboard: async (text: string) => { order.push(`clipboard ${text}`); } });
    socket.onSend = command => { order.push(`keys ${(command.params.keys as string[]).join("+")}`); socket.reply(command.id); };
    await driver.execute({ kind: "replaceText", text: "채식주의자 2" });
    expect(order).toEqual(["clipboard 채식주의자 2", `keys ${AT_DRIVER_KEYS.Meta}+a`, `keys ${AT_DRIVER_KEYS.Backspace}`, `keys ${AT_DRIVER_KEYS.Meta}+v`]);
    expect(events.filter(e => e.type === "clipboard")).toMatchObject([{ characters: 7 }]);
    expect(JSON.stringify(events)).not.toContain("채식주의자");
    order.length = 0;
    await driver.execute({ kind: "typeText", text: "ab" });
    expect(order).toEqual(["keys a", "keys b"]);
    await driver.close();
  });

  it("fails without touching the field when the clipboard cannot be written", async () => {
    const { socket, backend: driver } = await backend("voiceover", { clipboard: async () => { throw new Error("pbcopy missing"); } });
    await expect(driver.execute({ kind: "typeText", text: "배" })).rejects.toThrow("pbcopy missing");
    expect(socket.sent).toHaveLength(1);
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
    expect(socket.sent.slice(1).map(command => command.params.keys)).toEqual([[AT_DRIVER_KEYS.Shift, "a"]]);
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
    expect(socket.sent.slice(1).map(command => command.params.keys)).toEqual([[AT_DRIVER_KEYS.Shift, "a"]]);
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
    expect(vo.mapAction({ kind: "intent", intent: "next" })).toEqual([[AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt, AT_DRIVER_KEYS.ArrowRight]]);
    expect(nvda.mapAction({ kind: "intent", intent: "next" })).toEqual([[AT_DRIVER_KEYS.ArrowDown]]);
    expect(vo.capabilities.intents).toContain("interact");
    expect(vo.capabilities.intents).toEqual(expect.arrayContaining(["heading.previous", "form.previous", "link.previous"]));
    expect(vo.commands["link.previous"]).toBe("find previous link");
    expect(nvda.commands).toEqual({});
    expect(nvda.mapAction({ kind: "intent", intent: "link.previous" })).toEqual([[AT_DRIVER_KEYS.Shift, "k"]]);
    expect(nvda.capabilities.intents).not.toContain("interact");
    expect(vo.mapAction({ kind: "typeText", text: "한글" })).toEqual([[AT_DRIVER_KEYS.Meta, "v"]]);
    expect(vo.pasteText({ kind: "typeText", text: "한글" })).toBe("한글");
    expect(vo.pasteText({ kind: "typeText", text: "abc" })).toBeUndefined();
    expect(() => nvda.mapAction({ kind: "typeText", text: "한글" })).toThrow(/unsupported/);
    expect(nvda.pasteText({ kind: "typeText", text: "한글" })).toBeUndefined();
    expect(Object.isFrozen(vo.capabilities.intents)).toBe(true);
  });
});

describe('real VoiceOver speech', () => {
  const vo = [AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt];
  const next = [...vo, AT_DRIVER_KEYS.ArrowRight], interact = [...vo, AT_DRIVER_KEYS.Shift, AT_DRIVER_KEYS.ArrowDown];
  const name = (keys: readonly string[]) => keys.join('+');
  /** A reader that says the next lines in order for each press of a key, as VoiceOver 26 did in the validation VM. */
  const scripted = (socket: Awaited<ReturnType<typeof backend>>['socket'], script: Record<string, string[][]>) => {
    socket.onSend = command => {
      socket.reply(command.id);
      for (const text of script[name(command.params.keys as string[])]?.shift() ?? []) socket.output(text);
    };
  };
  const finish = async <T,>(work: Promise<T>) => { const failed = work.catch(error => error as Error); await vi.advanceTimersByTimeAsync(10_000); return failed; };
  const sent = (socket: Awaited<ReturnType<typeof backend>>['socket']) => socket.sent.slice(1).map(command => command.params.keys as string[]);

  it('finds a rotor list that says its name and then its current item, and picks from it', async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    scripted(socket, {
      [name([...vo, 'u'])]: [['Headings menu', ' On item 1: Form check']],
      [name([AT_DRIVER_KEYS.ArrowRight])]: [['Form Controls menu', ' On item Query edit text']],
    });
    await finish(driver.execute({ kind: 'intent', intent: 'formControls.rotor' }));
    await finish(driver.execute({ kind: 'intent', intent: 'activate' }));
    expect(sent(socket)).toEqual([[...vo, 'u'], [AT_DRIVER_KEYS.ArrowRight], [AT_DRIVER_KEYS.Enter]]);
  });
  it('reads a rotor list found that way to its end', async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    scripted(socket, {
      [name([...vo, 'u'])]: [['Headings menu', ' On item 1: Heading check']],
      [name([AT_DRIVER_KEYS.ArrowDown])]: [['2: Target section'], ['1: Heading check'], ['2: Target section'], ['1: Heading check']],
    });
    await finish(driver.execute({ kind: 'intent', intent: 'headings.list' }));
    expect((await settle(driver)).speech).toEqual(expect.arrayContaining(['2: Target section']));
    expect(sent(socket).at(-1)).toEqual([AT_DRIVER_KEYS.Escape]);
    expect(sent(socket)).not.toContainEqual([AT_DRIVER_KEYS.ArrowRight]);
  });
  it('does not take an item named like the wanted list for the list', async () => {
    const { socket, backend: driver } = await backend();
    await settle(driver);
    scripted(socket, {
      [name([...vo, 'u'])]: [['Form Controls menu', ' On item Show headings checkbox']],
      [name([AT_DRIVER_KEYS.ArrowRight])]: [['Headings menu', ' On item 1: Heading check']],
    });
    await finish(driver.execute({ kind: 'intent', intent: 'headings.list' }));
    expect(sent(socket).slice(0, 2)).toEqual([[...vo, 'u'], [AT_DRIVER_KEYS.ArrowRight]]);
  });

  /** VoiceOver's cursor as the screen shows it: on the browser's controls, on the web content as a whole, or on something in the page. */
  const PAGE = { x: 44, y: 117, width: 1280, height: 800 };
  const TOOLBAR = { x: 180, y: 103, width: 913, height: 24 }, TABS = { x: 150, y: 60, width: 230, height: 30 }, ON = { ...PAGE };
  const IN = { x: 44, y: 117, width: 1265, height: 325 };
  type Rect = typeof PAGE;
  /** A screen whose cursor goes to the next place on each press of a key, saying the given lines; the locator reads it. */
  const onScreen = (start: Rect) => {
    const screen = { cursor: start, pids: [] as (number | undefined)[] };
    const cursorLocator: CursorLocator = { page: async pid => { screen.pids.push(pid); return PAGE; }, cursor: async () => screen.cursor };
    const moving = (socket: Awaited<ReturnType<typeof backend>>['socket'], script: Record<string, { say: string[]; at: Rect }[]>) => {
      socket.onSend = command => {
        socket.reply(command.id);
        const step = script[name(command.params.keys as string[])]?.shift();
        if (!step) return;
        screen.cursor = step.at;
        for (const text of step.say) socket.output(text);
      };
    };
    return { screen, cursorLocator, moving };
  };

  it('walks from the browser\'s controls to the web content by where the cursor is, goes in, and keeps only what was said on load and on going in', async () => {
    const { cursorLocator, moving } = onScreen(TOOLBAR);
    const { socket, backend: driver } = await backend('voiceover', { cursorLocator });
    await settle(driver);
    moving(socket, { [name(next)]: [{ say: ['New Tab description, New tab button'], at: TABS }, { say: ['toolbar item palette'], at: TOOLBAR }, { say: ['Page web content'], at: ON }], [name(interact)]: [{ say: ['In Page web content main'], at: IN }] });
    socket.output('Page web content');
    expect(await finish(driver.enterPage())).toEqual({ entered: true, moves: 3 });
    expect(sent(socket)).toEqual([next, next, next, interact]);
    expect((await settle(driver)).speech).toEqual(['Page web content', 'In Page web content main']);
  });
  it('keeps what the reader said on the move that went straight onto something in the page', async () => {
    const { cursorLocator, moving } = onScreen(TOOLBAR);
    const { socket, backend: driver } = await backend('voiceover', { cursorLocator });
    await settle(driver);
    moving(socket, { [name(next)]: [{ say: ['toolbar item palette'], at: TOOLBAR }, { say: ['heading level 1 Products'], at: IN }] });
    socket.output('Shop web content');
    expect(await finish(driver.enterPage())).toEqual({ entered: true, moves: 2 });
    expect(sent(socket)).toEqual([next, next]);
    expect((await settle(driver)).speech).toEqual(['Shop web content', 'heading level 1 Products']);
  });
  it('presses nothing when the reader is already in the page, whatever language it speaks', async () => {
    const { cursorLocator } = onScreen({ x: 196, y: 137, width: 631, height: 30 });
    const { socket, backend: driver } = await backend('voiceover', { cursorLocator });
    await settle(driver);
    socket.output('현재 웹 콘텐츠 안에 있는 머리말에 있습니다.');
    expect(await finish(driver.enterPage())).toEqual({ entered: false, moves: 0, reason: 'VoiceOver was already in the page' });
    expect(sent(socket)).toEqual([]);
  });
  it('goes straight in when the cursor is on the web content itself', async () => {
    const { cursorLocator, moving } = onScreen(ON);
    const { socket, backend: driver } = await backend('voiceover', { cursorLocator });
    await settle(driver);
    moving(socket, { [name(interact)]: [{ say: ['In 올리브영 web content'], at: IN }] });
    expect(await finish(driver.enterPage())).toEqual({ entered: true, moves: 0 });
    expect(sent(socket)).toEqual([interact]);
  });
  it('never goes in from anywhere else: going in on the tab group lands on its Close button', async () => {
    const { cursorLocator, moving } = onScreen(TOOLBAR);
    const { socket, backend: driver } = await backend('voiceover', { cursorLocator });
    await settle(driver);
    moving(socket, { [name(next)]: Array.from({ length: 20 }, () => ({ say: ['Other item'], at: TABS })) });
    const failed = await finish(driver.enterPage());
    expect(failed).toMatchObject({ code: 'page entry failed' });
    expect(sent(socket)).not.toContainEqual(interact);
    expect(sent(socket)).toHaveLength(8);
  });
  it('fails when going in lands outside the page', async () => {
    const { cursorLocator, moving } = onScreen(ON);
    const { socket, backend: driver } = await backend('voiceover', { cursorLocator });
    await settle(driver);
    moving(socket, { [name(interact)]: [{ say: ['Close button'], at: TABS }] });
    expect(await finish(driver.enterPage())).toMatchObject({ code: 'page entry failed' });
  });
  it('takes landing on something exactly the page\'s size as going in when the reader said where it went, and not when it said nothing', async () => {
    for (const [say, entered] of [[['In Page web content main'], true], [[], false]] as const) {
      const { cursorLocator, moving } = onScreen(ON);
      const { socket, backend: driver } = await backend('voiceover', { cursorLocator });
      await settle(driver);
      moving(socket, { [name(interact)]: [{ say: [...say], at: ON }] });
      const result = await finish(driver.enterPage());
      if (entered) expect(result).toEqual({ entered: true, moves: 0 });
      else expect(result).toMatchObject({ code: 'page entry failed' });
    }
  });
  it('closes a rotor list the last action left open before walking to a new page, so the walk\'s keys do not go to the list', async () => {
    const { cursorLocator, moving } = onScreen(ON);
    const { socket, backend: driver } = await backend('voiceover', { cursorLocator });
    await settle(driver);
    scripted(socket, { [name([...vo, 'u'])]: [['Form Controls menu', ' On item Query edit text']] });
    await finish(driver.execute({ kind: 'intent', intent: 'formControls.rotor' }));
    await settle(driver);
    const before = sent(socket).length;
    moving(socket, { [name(interact)]: [{ say: ['In Page web content main'], at: IN }] });
    expect(await finish(driver.enterPage())).toEqual({ entered: true, moves: 0 });
    expect(sent(socket).slice(before)).toEqual([[AT_DRIVER_KEYS.Escape], interact]);
    // The rotor is closed for the backend too: next moves the cursor, not the list.
    await settle(driver);
    await finish(driver.execute({ kind: 'intent', intent: 'next' }));
    expect(sent(socket).at(-1)).toEqual(next);
  });
  it('looks for the page in the window of the browser that shows it', async () => {
    const { screen, cursorLocator } = onScreen(IN);
    const { backend: driver } = await backend('voiceover', { cursorLocator });
    await settle(driver);
    driver.attachSession({ page: {}, browserProcessId: 4242 });
    await finish(driver.enterPage());
    expect(screen.pids).toEqual([4242]);
  });
  it('presses nothing for NVDA, which has no web content to walk to', async () => {
    const { socket, backend: driver } = await backend('nvda');
    await settle(driver);
    expect(await finish(driver.enterPage())).toEqual({ entered: false, moves: 0 });
    expect(sent(socket)).toEqual([]);
  });
});

describe('where VoiceOver\'s cursor is, from the screen', () => {
  // Measured on VoiceOver 26.6.2 with Chrome on GOV.UK: the page, and the cursor in each place.
  const page = { x: 44, y: 117, width: 1280, height: 800 };
  it('is on the web content only when it covers exactly the page, so a main region one scroll bar narrower is inside', () => {
    expect(placeOf({ ...page }, page)).toBe('on');
    expect(placeOf({ x: 44, y: 117, width: 1265, height: 800 }, page)).toBe('inside');
    expect(placeOf({ x: 776, y: 789, width: 51, height: 51 }, page)).toBe('inside');
    expect(placeOf({ x: 180, y: 103, width: 913, height: 24 }, page)).toBe('outside');
  });
  it('is in the page only when it lies within it: a control that hangs over the page\'s top, or a window that holds the page, is the browser\'s', () => {
    // The address bar's box reaches 10 points into the page; a taller control on that row has its middle in the page.
    expect(placeOf({ x: 1146, y: 98, width: 34, height: 44 }, page)).toBe('outside');
    expect(placeOf({ x: 44, y: 30, width: 1280, height: 887 }, page)).toBe('outside');
    expect(placeOf({ x: 0, y: 0, width: 1440, height: 900 }, page)).toBe('outside');
    // An item cut to the page's edges, one point of rounding allowed.
    expect(placeOf({ x: 43.5, y: 116.5, width: 600, height: 800.8 }, page)).toBe('inside');
  });
  it('asks VoiceOver and the browser\'s window through osascript, and says what to turn on when it cannot', async () => {
    const calls: string[][] = [];
    const reading = voiceoverCursorLocator(async args => { calls.push(args); return JSON.stringify({ cursor: { x: 1, y: 2, width: 3, height: 4 }, page: { x: 0, y: 0, width: 10, height: 10 } }); });
    expect(await reading.cursor()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(await reading.page(4242)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(calls.map(args => args.slice(-2))).toEqual([[expect.stringContaining('voCursor'), 'cursor'], ['page', '4242']]);
    // VoiceOver reading a new page aloud can answer null now and then: asked again, it answers.
    const answers = [null, null, { x: 5, y: 6, width: 7, height: 8 }];
    const waits: number[] = [];
    const busy = voiceoverCursorLocator(async () => JSON.stringify({ cursor: answers.shift() }), async ms => { waits.push(ms); });
    expect(await busy.cursor()).toEqual({ x: 5, y: 6, width: 7, height: 8 });
    expect(waits).toEqual([300, 300]);
    let asked = 0;
    const silent = voiceoverCursorLocator(async () => { asked++; return JSON.stringify({ cursor: null }); }, async () => {});
    await expect(silent.cursor()).rejects.toMatchObject({ code: 'cursor place unknown', message: expect.stringMatching(/asked 5 times/) });
    expect(asked).toBe(5);
    const refused = voiceoverCursorLocator(async () => { throw new Error('execution error: Not authorized to send Apple events to VoiceOver. (-1743)'); });
    await expect(refused.cursor()).rejects.toMatchObject({ code: 'cursor place unknown', message: expect.stringMatching(/Not authorized.*Allow VoiceOver to be controlled with AppleScript/s) });
  });
});

describe('VoiceOver helpers outside AT Driver', () => {
  it('checks both the cursor and the page question, so a missing System Events permission shows before a run', async () => {
    const asked: string[] = [];
    const answering = voiceoverCursorLocator(async args => { asked.push(args[4]!); return JSON.stringify({ cursor: { x: 1, y: 2, width: 3, height: 4 } }); });
    await checkVoiceOverPlace(answering);
    expect(asked).toEqual(['cursor', 'page']);
    const noSystemEvents = voiceoverCursorLocator(async args => { if (args[4] === 'page') throw new Error('Not authorized to send Apple events to System Events.'); return JSON.stringify({ cursor: { x: 1, y: 2, width: 3, height: 4 } }); });
    await expect(checkVoiceOverPlace(noSystemEvents)).rejects.toThrow(/Not authorized to send Apple events to System Events.*control VoiceOver and System Events/s);
  });
  it('fails the paste, not the process, when the clipboard command is missing or stops before reading the text', async () => {
    await expect(macClipboard('rawstep-no-such-clipboard-command')('배')).rejects.toMatchObject({ code: 'clipboard failed' });
    // `false` exits at once, so a text larger than the pipe's buffer is still being written when its input closes.
    await expect(macClipboard('false')('배'.repeat(400_000))).rejects.toMatchObject({ code: 'clipboard failed', message: expect.stringContaining('false exited with 1') });
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
    expect(() => make('ws://example.test/session', 'nvda').preflight({ platform: 'linux', headless: true, customBrowserSession: true })).not.toThrow();
    expect(() => make('ws://localhost/session').preflight({ platform: 'linux', headless: true, customBrowserSession: true })).not.toThrow();
  });
  it('takes what a reader needs of its host from the profile: VoiceOver has helpers for this machine, NVDA needs none, and the backend follows the contract', () => {
    const voiceover = getAtDriverProfile('voiceover'), nvda = getAtDriverProfile('nvda');
    expect([voiceover.platform, nvda.platform]).toEqual(['darwin', 'win32']);
    expect(Object.keys(voiceover.hostHelpers ?? {}).sort()).toEqual(['clipboard', 'commander', 'cursorLocator']);
    expect(nvda.hostHelpers).toBeUndefined();
    expect(nvda.pageEntry).toBeUndefined(); expect(nvda.commands).toEqual({}); expect(nvda.pasteText({ kind: 'typeText', text: '배' })).toBeUndefined();
    // A native bridge asks the runner for the longer close budget.
    expect(make('ws://localhost/session').cleanupTimeoutMs).toBe(5_000);
  });
  it('refuses a paired VoiceOver on another machine unless the helpers that reach that Mac are passed in', () => {
    const paired = { platform: 'linux', headless: true, customBrowserSession: true };
    expect(() => make('ws://example.test/session').preflight(paired)).toThrow(expect.objectContaining({ code: 'backend-precondition', message: expect.stringMatching(/cursorLocator, commander and clipboard/) }));
    const helpers = { cursorLocator: { page: async () => undefined, cursor: async () => ({ x: 0, y: 0, width: 1, height: 1 }) }, commander: async () => {}, clipboard: async () => {} };
    const remote = new AtDriverBackend({ url: 'ws://example.test/session', profile: 'voiceover', webSocketFactory: () => { throw new Error('preflight must not connect'); }, ...helpers });
    expect(() => remote.preflight(paired)).not.toThrow();
  });
});
