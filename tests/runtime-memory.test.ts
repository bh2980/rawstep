import { describe, expect, it } from "vitest";
import { createAgentMemoryEntry } from "../packages/runtime/src/run/helpers";

describe("createAgentMemoryEntry", () => {
  it("records screenreader observation facts and repeat counts", () => {
    const first = createAgentMemoryEntry(
      0,
      {
        action: {
          srAction: {
            semantic: "next"
          }
        }
      },
      "continued",
      {
        observation: {
          kind: "screenreader",
          announcement: "  Add to cart button \n link  ",
          announcementCapture: "log",
          announcementCount: 2,
          observeReason: "silence"
        }
      }
    );

    expect(first).toMatchObject({
      step: 0,
      action: "sr.next",
      outcome: "continued",
      announcementExcerpt: "Add to cart button link",
      announcementCapture: "log",
      announcementCount: 2,
      observeReason: "silence",
      sameAnnouncementCount: 1,
      sameActionCount: 1
    });

    const repeated = createAgentMemoryEntry(
      1,
      {
        action: {
          srAction: {
            semantic: "next"
          }
        }
      },
      "continued",
      {
        observation: {
          kind: "screenreader",
          announcement: "Add to cart button link",
          announcementCapture: "fallback",
          announcementCount: 1,
          observeReason: "fallback"
        },
        previousEntry: first
      }
    );

    expect(repeated.sameAnnouncementCount).toBe(2);
    expect(repeated.sameActionCount).toBe(2);
    expect(repeated.announcementCapture).toBe("fallback");
    expect(repeated.observeReason).toBe("fallback");

    const changed = createAgentMemoryEntry(
      2,
      {
        action: {
          srAction: {
            semantic: "next"
          }
        }
      },
      "continued",
      {
        observation: {
          kind: "screenreader",
          announcement: "",
          announcementCapture: "none",
          observeReason: "timeout"
        },
        previousEntry: repeated
      }
    );

    expect(changed.announcementExcerpt).toBe("");
    expect(changed.sameAnnouncementCount).toBe(1);
    expect(changed.sameActionCount).toBe(3);
    expect(changed.announcementCapture).toBe("none");
    expect(changed.observeReason).toBe("timeout");
  });

  it("keeps keyboard memory minimal and only tracks repeated actions", () => {
    const first = createAgentMemoryEntry(
      0,
      {
        action: {
          key: "Tab"
        }
      },
      "continued"
    );

    const repeated = createAgentMemoryEntry(
      1,
      {
        action: {
          key: "Tab"
        }
      },
      "continued",
      {
        observation: {
          kind: "keyboard",
          screenshot: {
            pngBase64: "current-image",
            viewport: { w: 1280, h: 720 }
          },
          browserChrome: {
            title: "Simple CTA Fixture",
            urlPath: "/fixture"
          }
        },
        previousEntry: first
      }
    );

    expect(repeated).toMatchObject({
      step: 1,
      action: "key(Tab)",
      sameActionCount: 2
    });
    expect(repeated.announcementExcerpt).toBeUndefined();
    expect(repeated.announcementCapture).toBeUndefined();
    expect(repeated.announcementCount).toBeUndefined();
    expect(repeated.observeReason).toBeUndefined();
    expect(repeated.sameAnnouncementCount).toBeUndefined();
  });
});
