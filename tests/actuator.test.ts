import { Actuator, NotAllowedKeyError } from "@a11y-task/actuator";
import { describe, expect, it, vi } from "vitest";

describe("Actuator", () => {
  it("presses allowed keys and tracks cost", async () => {
    const press = vi.fn(async () => undefined);
    const actuator = new Actuator({
      keyboard: { press }
    } as never);

    await actuator.press("Tab");

    expect(press).toHaveBeenCalledWith("Tab");
    expect(actuator.cost).toBe(1);
    expect(actuator.keyCounts.Tab).toBe(1);
  });

  it("rejects disallowed keys", async () => {
    const actuator = new Actuator({
      keyboard: { press: vi.fn(async () => undefined) }
    } as never);

    await expect(actuator.press("KeyA")).rejects.toBeInstanceOf(NotAllowedKeyError);
  });
});
