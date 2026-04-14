import { Actuator, NotAllowedActionError, closeBrowserSession, createBrowserSession } from "@rawstep/runtime";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

describe("Actuator", () => {
  it("presses allowed keys and tracks cost", async () => {
    const press = vi.fn(async () => undefined);
    const actuator = new Actuator({
      keyboard: { press }
    } as never);

    const result = await actuator.execute({ key: "Tab" });

    expect(press).toHaveBeenCalledWith("Tab");
    expect(result).toEqual({ ok: true, costDelta: 1 });
    expect(actuator.cost).toBe(1);
    expect(actuator.keyCounts.Tab).toBe(1);
  });

  it("rejects disallowed keys", async () => {
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined) }
    } as never);

    await expect(actuator.press("KeyA")).rejects.toBeInstanceOf(NotAllowedActionError);
  });

  it("delegates screen reader actions to the configured controller", async () => {
    const execute = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined) }
      } as never,
      {
        screenReaderController: { execute }
      }
    );

    const action = {
      kind: "invoke",
      method: "perform",
      command: { source: "catalog", id: "commands.moveToNextHeading" }
    } as const;
    const result = await actuator.execute({ srAction: action });

    expect(execute).toHaveBeenCalledWith(action);
    expect(result).toEqual({ ok: true, costDelta: 1 });
    expect(actuator.cost).toBe(1);
  });

  it("rejects screen reader actions when no controller is configured", async () => {
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined) }
    } as never);

    await expect(
      actuator.execute({
        srAction: {
          kind: "invoke",
          method: "perform",
          command: { source: "catalog", id: "commands.moveToNextHeading" }
        }
      })
    ).rejects.toThrow(
      "Screen reader actions are not available"
    );
  });

  it("types named task input into a focused input", async () => {
    const type = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => true);
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined), type },
      evaluate
    } as never);

    const result = await actuator.execute({ typeText: "email" }, { email: "passport" });

    expect(evaluate).toHaveBeenCalled();
    expect(type).toHaveBeenCalledWith("passport");
    expect(result).toEqual({ ok: true, costDelta: 1 });
    expect(actuator.cost).toBe(1);
  });

  it("returns a low-info failure when text entry is not allowed by the gate", async () => {
    const type = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => false);
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined), type },
      evaluate
    } as never);

    const result = await actuator.execute({ typeText: "email" }, { email: "passport" });

    expect(type).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Action did not produce an observable text-entry state change.");
  });

  it("rejects task text input when the task did not opt in", async () => {
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined), type: vi.fn(async () => undefined) },
      evaluate: vi.fn(async () => true)
    } as never);

    await expect(actuator.execute({ typeText: "email" })).rejects.toBeInstanceOf(NotAllowedActionError);
  });

  it("returns a distinct failure when the named input key is missing", async () => {
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined), type: vi.fn(async () => undefined) },
      evaluate: vi.fn(async () => true)
    } as never);

    const result = await actuator.execute({ typeText: "password" }, { email: "passport" });

    expect(result).toEqual({
      ok: false,
      costDelta: 0,
      error: 'Task input key "password" is not available for this task.'
    });
  });

  it("types task text into a focused textarea", async () => {
    const fixturePath = await writeActuatorFixture(
      [
        "<textarea id=\"box\"></textarea>",
        "<script>window.addEventListener('load', () => document.getElementById('box').focus());</script>"
      ].join("\n")
    );
    const session = await createBrowserSession(pathToFileURL(fixturePath).toString());

    try {
      const actuator = new Actuator(session.page);
      const result = await actuator.execute({ typeText: "email" }, { email: "passport" });
      const value = await session.page.evaluate(() => (document.getElementById("box") as HTMLTextAreaElement).value);

      expect(result).toEqual({ ok: true, costDelta: 1 });
      expect(value).toBe("passport");
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("types task text into a focused contenteditable target", async () => {
    const fixturePath = await writeActuatorFixture(
      [
        "<div id=\"box\" contenteditable=\"true\"></div>",
        "<script>window.addEventListener('load', () => document.getElementById('box').focus());</script>"
      ].join("\n")
    );
    const session = await createBrowserSession(pathToFileURL(fixturePath).toString());

    try {
      const actuator = new Actuator(session.page);
      const result = await actuator.execute({ typeText: "email" }, { email: "passport" });
      const value = await session.page.evaluate(() => document.getElementById("box")?.textContent);

      expect(result).toEqual({ ok: true, costDelta: 1 });
      expect(value).toBe("passport");
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("blocks readonly inputs even when they are focused", async () => {
    const fixturePath = await writeActuatorFixture(
      [
        "<input id=\"box\" readonly value=\"locked\" />",
        "<script>window.addEventListener('load', () => document.getElementById('box').focus());</script>"
      ].join("\n")
    );
    const session = await createBrowserSession(pathToFileURL(fixturePath).toString());

    try {
      const actuator = new Actuator(session.page);
      const result = await actuator.execute({ typeText: "email" }, { email: "passport" });
      const value = await session.page.evaluate(() => (document.getElementById("box") as HTMLInputElement).value);

      expect(result).toEqual({
        ok: false,
        costDelta: 0,
        error: "Action did not produce an observable text-entry state change."
      });
      expect(value).toBe("locked");
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("blocks disabled textareas even when script focuses them", async () => {
    const fixturePath = await writeActuatorFixture(
      [
        "<textarea id=\"box\" disabled>locked</textarea>",
        "<script>window.addEventListener('load', () => document.getElementById('box').focus());</script>"
      ].join("\n")
    );
    const session = await createBrowserSession(pathToFileURL(fixturePath).toString());

    try {
      const actuator = new Actuator(session.page);
      const result = await actuator.execute({ typeText: "email" }, { email: "passport" });
      const value = await session.page.evaluate(() => (document.getElementById("box") as HTMLTextAreaElement).value);

      expect(result).toEqual({
        ok: false,
        costDelta: 0,
        error: "Action did not produce an observable text-entry state change."
      });
      expect(value).toBe("locked");
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("blocks task text input on focused non-text controls", async () => {
    const fixturePath = await writeActuatorFixture(
      [
        "<button id=\"box\">Go</button>",
        "<script>window.addEventListener('load', () => document.getElementById('box').focus());</script>"
      ].join("\n")
    );
    const session = await createBrowserSession(pathToFileURL(fixturePath).toString());

    try {
      const actuator = new Actuator(session.page);
      const result = await actuator.execute({ typeText: "email" }, { email: "passport" });
      const buttonText = await session.page.evaluate(() => document.getElementById("box")?.textContent);

      expect(result).toEqual({
        ok: false,
        costDelta: 0,
        error: "Action did not produce an observable text-entry state change."
      });
      expect(buttonText).toBe("Go");
    } finally {
      await closeBrowserSession(session);
    }
  });
});

async function writeActuatorFixture(body: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "a11y-actuator-fixture-"));
  const fixturePath = join(tempDir, "index.html");

  await writeFile(
    fixturePath,
    [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="utf-8" />',
      "    <title>Actuator Fixture</title>",
      "  </head>",
      "  <body>",
      body,
      "  </body>",
      "</html>"
    ].join("\n"),
    "utf8"
  );

  return fixturePath;
}
