import { Actuator, NotAllowedActionError, closeBrowserSession, createBrowserSession } from "@rawstep/runtime";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { resolveKeyboardPressKey } from "../packages/runtime/src/actuator/keys";

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

  it("maps Mod shortcuts to the platform-specific modifier", () => {
    expect(resolveKeyboardPressKey("Mod+A", "darwin")).toBe("Meta+A");
    expect(resolveKeyboardPressKey("Mod+Shift+Z", "darwin")).toBe("Meta+Shift+Z");
    expect(resolveKeyboardPressKey("Mod+A", "linux")).toBe("Control+A");
    expect(resolveKeyboardPressKey("Mod+Shift+Z", "win32")).toBe("Control+Shift+Z");
    expect(resolveKeyboardPressKey("Backspace", "darwin")).toBe("Backspace");
    expect(resolveKeyboardPressKey("Shift+Enter", "linux")).toBe("Shift+Enter");
  });

  it("resolves Mod shortcuts before pressing them", async () => {
    const press = vi.fn(async () => undefined);
    const actuator = new Actuator({
      keyboard: { press }
    } as never);

    const result = await actuator.execute({ key: "Mod+A" });

    expect(press).toHaveBeenCalledWith(resolveKeyboardPressKey("Mod+A"));
    expect(result).toEqual({ ok: true, costDelta: 1 });
    expect(actuator.keyCounts["Mod+A"]).toBe(1);
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
      extension: "catalog",
      id: "commands.moveToNextHeading"
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
          extension: "catalog",
          id: "commands.moveToNextHeading"
        }
      })
    ).rejects.toThrow(
      "Screen reader actions are not available"
    );
  });

  it("types a direct task input value into a focused input", async () => {
    const type = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => true);
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined), type },
      evaluate
    } as never);

    const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });

    expect(evaluate).toHaveBeenCalled();
    expect(type).toHaveBeenCalledWith("passport");
    expect(result).toEqual({ ok: true, costDelta: 1 });
    expect(actuator.cost).toBe(1);
  });

  it("replaces existing text before typing a direct task input value", async () => {
    const press = vi.fn(async () => undefined);
    const type = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => true);
    const actuator = new Actuator({
      keyboard: { press, type },
      evaluate
    } as never);

    const result = await actuator.execute({ replaceText: "passport" }, { email: "passport" });

    expect(press).toHaveBeenNthCalledWith(1, resolveKeyboardPressKey("Mod+A"));
    expect(press).toHaveBeenNthCalledWith(2, resolveKeyboardPressKey("Backspace"));
    expect(type).toHaveBeenCalledWith("passport");
    expect(result).toEqual({ ok: true, costDelta: 1 });
    expect(actuator.cost).toBe(1);
  });

  it("routes direct task input values through the screen reader controller when configured", async () => {
    const execute = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const evaluate = vi.fn(async () => true);
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined), type: vi.fn(async () => undefined) },
        evaluate
      } as never,
      {
        screenReaderController: { execute },
        useScreenReaderTextEntry: true
      }
    );

    const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });

    expect(evaluate).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith({
      semantic: "type",
      text: "passport"
    });
    expect(result).toEqual({ ok: true, costDelta: 1 });
    expect(actuator.cost).toBe(1);
  });

  it("prefers the screen reader controller internal path for direct task input values when available", async () => {
    const execute = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const executeInternal = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const evaluate = vi.fn(async () => true);
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined), type: vi.fn(async () => undefined) },
        evaluate
      } as never,
      {
        screenReaderController: { execute, executeInternal },
        useScreenReaderTextEntry: true
      }
    );

    const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });

    expect(evaluate).toHaveBeenCalled();
    expect(executeInternal).toHaveBeenCalledWith({
      semantic: "type",
      text: "passport"
    });
    expect(execute).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, costDelta: 1 });
    expect(actuator.cost).toBe(1);
  });

  it("uses a synthetic VoiceOver text-entry path for typeText when configured", async () => {
    const type = vi.fn(async () => undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        observed: "traveler@example.com",
        role: "email",
        label: "Email",
        labelledByText: "",
        labelsText: "",
        placeholder: undefined,
        isSensitive: false,
      });
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined), type },
        evaluate
      } as never,
      {
        useScreenReaderTextEntry: true,
        screenReaderBackendId: "guidepup-voiceover",
        screenReaderController: { execute: vi.fn(async () => ({ ok: true, costDelta: 1 })) }
      }
    );

    const result = await actuator.execute({ typeText: "traveler@example.com" }, { email: "traveler@example.com" });

    expect(type).toHaveBeenCalledWith("traveler@example.com");
    expect(result).toEqual({
      ok: true,
      costDelta: 1,
      textEntryResult: {
        expected: "traveler@example.com",
        observed: "traveler@example.com",
        verified: true,
        fieldLabel: "Email",
        fieldRole: "email",
        isSensitive: false,
        syntheticAnnouncement: "Email, current value traveler@example.com"
      }
    });
  });

  it("uses a synthetic VoiceOver text-entry path for replaceText when configured", async () => {
    const press = vi.fn(async () => undefined);
    const type = vi.fn(async () => undefined);
    const execute = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        observed: "traveler@example.com",
        role: "email",
        label: "Email",
        labelledByText: "",
        labelsText: "",
        placeholder: undefined,
        isSensitive: false,
      });
    const actuator = new Actuator(
      {
        keyboard: { press, type },
        evaluate
      } as never,
      {
        useScreenReaderTextEntry: true,
        screenReaderBackendId: "guidepup-voiceover",
        screenReaderController: { execute }
      }
    );

    const result = await actuator.execute({ replaceText: "traveler@example.com" }, { email: "traveler@example.com" });

    expect(execute).toHaveBeenNthCalledWith(1, { semantic: "key.mod.a" });
    expect(execute).toHaveBeenNthCalledWith(2, { semantic: "key.backspace" });
    expect(press).not.toHaveBeenCalled();
    expect(type).toHaveBeenCalledWith("traveler@example.com");
    expect(result).toEqual({
      ok: true,
      costDelta: 1,
      textEntryResult: {
        expected: "traveler@example.com",
        observed: "traveler@example.com",
        verified: true,
        fieldLabel: "Email",
        fieldRole: "email",
        isSensitive: false,
        syntheticAnnouncement: "Email, current value traveler@example.com"
      }
    });
  });

  it("synchronizes keyboard focus to the VoiceOver cursor before text entry when needed", async () => {
    const type = vi.fn(async () => undefined);
    const executeInternal = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        observed: "traveler@example.com",
        role: "email",
        label: "Email",
        labelledByText: "",
        labelsText: "",
        placeholder: undefined,
        isSensitive: false,
      });
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined), type },
        evaluate
      } as never,
      {
        useScreenReaderTextEntry: true,
        screenReaderBackendId: "guidepup-voiceover",
        screenReaderController: {
          execute: vi.fn(async () => ({ ok: true, costDelta: 1 })),
          executeInternal
        }
      }
    );

    const result = await actuator.execute({ typeText: "traveler@example.com" }, { email: "traveler@example.com" });

    expect(executeInternal).toHaveBeenCalledWith({
      extension: "catalog",
      id: "keyboard.moveKeyboardFocusToCursor"
    });
    expect(type).toHaveBeenCalledWith("traveler@example.com");
    expect(result).toEqual({
      ok: true,
      costDelta: 1,
      textEntryResult: {
        expected: "traveler@example.com",
        observed: "traveler@example.com",
        verified: true,
        fieldLabel: "Email",
        fieldRole: "email",
        isSensitive: false,
        syntheticAnnouncement: "Email, current value traveler@example.com"
      }
    });
  });

  it("falls back to execute when internal VoiceOver focus sync is unavailable", async () => {
    const type = vi.fn(async () => undefined);
    const execute = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        observed: "traveler@example.com",
        role: "email",
        label: "Email",
        labelledByText: "",
        labelsText: "",
        placeholder: undefined,
        isSensitive: false,
      });
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined), type },
        evaluate
      } as never,
      {
        useScreenReaderTextEntry: true,
        screenReaderBackendId: "guidepup-voiceover",
        screenReaderController: { execute }
      }
    );

    const result = await actuator.execute({ typeText: "traveler@example.com" }, { email: "traveler@example.com" });

    expect(execute).toHaveBeenCalledWith({
      extension: "catalog",
      id: "keyboard.moveKeyboardFocusToCursor"
    });
    expect(type).toHaveBeenCalledWith("traveler@example.com");
    expect(result.ok).toBe(true);
  });

  it("returns a low-info failure when text entry is not allowed by the gate", async () => {
    const type = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => false);
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined), type },
      evaluate
    } as never);

    const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });

    expect(type).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Action did not produce an observable text-entry state change.");
  });

  it("does not try VoiceOver focus sync outside the VoiceOver text-entry path", async () => {
    const type = vi.fn(async () => undefined);
    const executeInternal = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const evaluate = vi.fn(async () => false);
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined), type },
        evaluate
      } as never,
      {
        useScreenReaderTextEntry: true,
        screenReaderBackendId: "guidepup-nvda",
        screenReaderController: {
          execute: vi.fn(async () => ({ ok: true, costDelta: 1 })),
          executeInternal
        }
      }
    );

    const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });

    expect(executeInternal).not.toHaveBeenCalled();
    expect(type).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      costDelta: 0,
      error: "Action did not produce an observable text-entry state change."
    });
  });

  it("falls back to the existing gate failure when VoiceOver focus sync does not help", async () => {
    const type = vi.fn(async () => undefined);
    const executeInternal = vi.fn(async () => ({ ok: true, costDelta: 1 }));
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined), type },
        evaluate
      } as never,
      {
        useScreenReaderTextEntry: true,
        screenReaderBackendId: "guidepup-voiceover",
        screenReaderController: {
          execute: vi.fn(async () => ({ ok: true, costDelta: 1 })),
          executeInternal
        }
      }
    );

    const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });

    expect(executeInternal).toHaveBeenCalledWith({
      extension: "catalog",
      id: "keyboard.moveKeyboardFocusToCursor"
    });
    expect(type).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      costDelta: 0,
      error: "Action did not produce an observable text-entry state change."
    });
  });

  it("swallows VoiceOver focus sync failures and preserves the existing gate failure", async () => {
    const type = vi.fn(async () => undefined);
    const executeInternal = vi.fn(async () => {
      throw new Error("sync unavailable");
    });
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const actuator = new Actuator(
      {
        keyboard: { press: vi.fn(async () => undefined), type },
        evaluate
      } as never,
      {
        useScreenReaderTextEntry: true,
        screenReaderBackendId: "guidepup-voiceover",
        screenReaderController: {
          execute: vi.fn(async () => ({ ok: true, costDelta: 1 })),
          executeInternal
        }
      }
    );

    const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });

    expect(executeInternal).toHaveBeenCalledWith({
      extension: "catalog",
      id: "keyboard.moveKeyboardFocusToCursor"
    });
    expect(type).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      costDelta: 0,
      error: "Action did not produce an observable text-entry state change."
    });
  });

  it("rejects task text input when the task did not opt in", async () => {
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined), type: vi.fn(async () => undefined) },
      evaluate: vi.fn(async () => true)
    } as never);

    await expect(actuator.execute({ typeText: "passport" })).rejects.toBeInstanceOf(NotAllowedActionError);
  });

  it("returns a distinct failure when the direct input value is not allowed", async () => {
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined), type: vi.fn(async () => undefined) },
      evaluate: vi.fn(async () => true)
    } as never);

    const result = await actuator.execute({ typeText: "super-secret" }, { email: "passport" });

    expect(result).toEqual({
      ok: false,
      costDelta: 0,
      error: 'Task input value "super-secret" is not available for this task.'
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
      const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });
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
      const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });
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
      const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });
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
      const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });
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
      const result = await actuator.execute({ typeText: "passport" }, { email: "passport" });
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
