import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { generateElements } from "../src/generate/elements.js";
import { generateScreening } from "../src/generate/screening.js";
import { generateWorkflows } from "../src/generate/workflows.js";
import { replayAction, replayCase } from "../src/replay.js";
import { chordKeys, VoSession } from "../src/session.js";
import { focusedAxNode, type AxDump } from "../src/axdump.js";

test("new fixtures keep the existing matrix intact and have valid reference/command metadata", () => {
  const original = generateElements(), screening = generateScreening(), workflows = generateWorkflows();
  assert.equal(original.cases.length, 392);
  assert.equal(Object.keys(original.pages).length, 222);
  assert.equal(screening.cases.length, 20);
  assert.equal(workflows.cases.length, 35);
  assert.equal(new Set(workflows.cases.map(c => c.id)).size, workflows.cases.length);
  for (const c of workflows.cases) {
    const html = workflows.pages[c.page.replace(/^pages\//, "").replace(/\.html$/, "")];
    assert.ok(html?.includes('id="before"') && html.includes('id="after"'), c.id);
    assert.equal(c.captureAxAfterSteps, true);
    for (const chord of c.chords) assert.ok(chordKeys(chord).length > 0, chord);
  }
});

test("silent observation stays open for delayed updates and rejects impossible windows", async () => {
  const session = new VoSession("ws://127.0.0.1:1/session"); // Never connected; no native session or keys.
  const start = Date.now();
  const heard = await session.listen({ quietMs: 5, minWaitMs: 120, maxWaitMs: 1000 });
  assert.ok(Date.now() - start >= 119);
  assert.equal(heard.reason, "quiet");
  assert.deepEqual(heard.utterances, []);
  assert.equal((await session.listen({ quietMs: 200, maxWaitMs: 40 })).reason, "deadline");
  await assert.rejects(session.listen({ minWaitMs: 100, maxWaitMs: 20 }), /Invalid listen window/);
  await assert.rejects(session.listen({ minWaitMs: Number.NaN }), /Invalid listen window/);
});

test("workflow alignment requires actual AX focus, not a stale AXFocused flag", () => {
  const dump = { focusedPath: null, truncated: false, root: { children: [{ AXRole: "AXButton", AXTitle: "Before marker", AXFocused: true }] } } as unknown as AxDump;
  assert.equal(focusedAxNode(dump), undefined);
  dump.focusedPath = [0];
  assert.equal(focusedAxNode(dump)?.AXTitle, "Before marker");
  dump.focusedPath = [5];
  assert.equal(focusedAxNode(dump), undefined);
  dump.focusedPath = [-1];
  assert.equal(focusedAxNode(dump), undefined);
  dump.focusedPath = [0]; dump.truncated = true;
  assert.equal(focusedAxNode(dump), undefined);
  assert.deepEqual(chordKeys("VO+Cmd+F4"), ["\uE009", "\uE00A", "\uE03D", "\uE034"]);
});

const focus = async (page: Page) => page.evaluate(() => document.activeElement?.id);
const attribute = (page: Page, id: string, name: string) => page.locator("#" + id).getAttribute(name);
const value = (page: Page, id: string) => page.locator("#" + id).inputValue();
const press = (page: Page, chord: string) => page.keyboard.press(
  chord.replace(/^Cmd\+/, process.platform === "darwin" ? "Meta+" : "Control+")
    .replace(/^(Left|Right|Up|Down)$/, "Arrow$1"));

test("working reference fixtures: keyboard behavior, state, names, focus and delayed updates", async t => {
  const generated = generateWorkflows();
  const dir = await mkdtemp(join(tmpdir(), "vo-fixtures-"));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await rm(dir, { recursive: true, force: true }); });
  for (const [id, html] of Object.entries(generated.pages)) await writeFile(join(dir, id + ".html"), html);
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));

  for (const c of generated.cases) {
    await t.test(c.id, async () => {
      await page.goto(pathToFileURL(join(dir, c.page.slice("pages/".length))).href);
      await page.locator("#before").waitFor();
      await page.waitForFunction(() => document.activeElement?.id === "before");
      const variant = c.id.slice(0, c.id.lastIndexOf("."));
      const modalFocus = ["opener", "delivery", "save", "cancel", "delivery", "cancel", "opener"];
      let updates = 0;
      if (c.axes.family === "live") await page.evaluate(() => {
        const state = window as unknown as { fixtureUpdateCount: number };
        state.fixtureUpdateCount = 0;
        new MutationObserver(() => state.fixtureUpdateCount++).observe(document.getElementById("message")!, { childList: true });
      });
      for (const [i, chord] of c.chords.entries()) {
        if (chord.startsWith("VO+")) continue; // Native reading commands require the macOS pilot, not a DOM oracle.
        await press(page, chord);
        if (variant === "modal-settings") {
          assert.equal(await focus(page), modalFocus[i]);
          assert.equal(await page.locator("#dialog").evaluate((d: HTMLDialogElement) => d.open), i > 0 && i < 6);
        }
        if (variant === "checkbox-toggle") assert.equal(await page.locator("#target").isChecked(), i === 1);
        if (variant === "switch-toggle") assert.equal(await attribute(page, "target", "aria-checked"), String(i === 1));
        if (variant === "favorite-toggle") assert.equal(await attribute(page, "target", "aria-pressed"), String(i === 1));
        if (variant === "faq-native") assert.equal(await page.locator("#details").evaluate((d: HTMLDetailsElement) => d.open), i === 1);
        if (variant === "faq-aria") {
          assert.equal(await attribute(page, "target", "aria-expanded"), String(i > 0 && i < 4));
          assert.equal(await page.locator("#answer").isVisible(), i > 0 && i < 4);
          if (i === 2) assert.equal(await focus(page), "inside");
        }
        if (variant.startsWith("tabs-")) {
          const selected = i === 0 || (i === 1 && variant === "tabs-manual") || (i === 3 && variant === "tabs-automatic") ? 0 : 1;
          assert.equal(await attribute(page, "tab" + selected, "aria-selected"), "true");
          assert.equal(await page.locator("#panel" + selected).isVisible(), true);
          assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
          assert.equal(await focus(page), "tab" + (i === 0 || i === 3 ? 0 : 1));
        }
        if (variant.startsWith("radio-")) {
          const selected = [0, 1, 2, 1][i]!;
          assert.equal(await focus(page), "radio" + selected);
          if (variant === "radio-native") assert.equal(await page.locator("#radio" + selected).isChecked(), true);
          else assert.equal(await attribute(page, "radio" + selected, "aria-checked"), "true");
        }
        if (variant === "slider-volume") assert.equal(await value(page, "target"), ["5", "6", "7", "6", "10", "0"][i]);
        if (variant === "text-editing") assert.equal(await value(page, "target"), ["", "c", "ca", "cat", "cat", "ct", "ct", "b", "be", "bee"][i]);
        if (variant === "search-autocomplete") {
          assert.equal(await focus(page), "query");
          if (i === 2) assert.equal(await attribute(page, "query", "aria-activedescendant"), "option0");
          if (c.axes.command === "choose" && i === 3) assert.equal(await attribute(page, "query", "aria-activedescendant"), "option1");
          if (i === c.chords.length - 1) {
            assert.equal(await value(page, "query"), c.axes.command === "choose" ? "Cat toy" : "c");
            assert.equal(await attribute(page, "query", "aria-expanded"), "false");
            assert.equal(await attribute(page, "query", "aria-activedescendant"), null);
          }
        }
        if (variant === "form-correction" && i === 2) {
          assert.equal(await focus(page), "username");
          assert.equal(await attribute(page, "username", "aria-invalid"), "true");
          assert.equal(await attribute(page, "username", "aria-describedby"), "hint error");
          assert.equal(await page.locator("#error").textContent(), "Username needs three characters.");
        }
        if (variant === "cart-update") {
          assert.equal(await page.locator("#cart").textContent(), ["Cart empty", "1 items, total 10 dollars", "2 items, total 20 dollars", "2 items, total 20 dollars", "1 items, total 10 dollars", "Cart empty"][i]);
          if (i === 5) { assert.equal(await focus(page), "add"); assert.equal(await page.locator("#remove").isDisabled(), true); }
        }
        if (c.axes.family === "live" && chord === "Enter") {
          updates++;
          await page.waitForFunction(n => (window as unknown as { fixtureUpdateCount: number }).fixtureUpdateCount >= n, updates);
          assert.equal(await page.locator("#message").textContent(), "Delivery arrives tomorrow");
          assert.equal(await focus(page), "trigger");
        }
      }
      if (variant === "search-results") {
        assert.equal(await page.locator("#count").textContent(), c.axes.command === "matches" ? "2 results" : "No results");
        assert.equal(await page.locator("#results li").count(), c.axes.command === "matches" ? 2 : 0);
        assert.equal(await value(page, "query"), c.axes.command === "matches" ? "cat" : "z");
      }
      if (variant === "form-correction") {
        assert.equal(await value(page, "username"), "cat");
        assert.equal(await attribute(page, "username", "aria-invalid"), "false");
        assert.equal(await attribute(page, "username", "aria-describedby"), "hint");
        assert.equal(await page.locator("#error").isVisible(), false);
        assert.equal(await page.locator("#status").textContent(), "Test account ready");
      }
      if (variant.startsWith("name-")) {
        const name = variant === "name-content" ? "Save" : variant === "name-labelledby-conflict" ? "Save profile settings" : "Save changes";
        assert.equal(await page.getByRole("button", { name, exact: true }).count(), 1);
      }
      if (variant === "context-group") assert.equal(await page.getByRole("group", { name: "Billing address", exact: true }).count(), 1);
      if (variant === "blog-headings") assert.deepEqual(await page.getByRole("heading").allTextContents(), ["Cat care", "Feeding", "Play time"]);
      if (variant === "tabs-manual" && c.axes.command === "select-return") {
        await press(page, "Tab"); assert.equal(await focus(page), "panel1");
        await press(page, "Shift+Tab"); assert.equal(await focus(page), "tab1");
      }
      assert.deepEqual(errors, []);
    });
  }
});

test("simulator records a missing command as a whole-case coverage gap", async () => {
  assert.deepEqual(replayAction("c", "letter"), { kind: "typeText", input: "letter" });
  assert.equal(replayAction("Down", "letter"), null);
  const dir = await mkdtemp(join(tmpdir(), "vo-replay-test-"));
  try {
    await writeFile(join(dir, "page.html"), '<!doctype html><title>Unsupported test</title><button autofocus>Before marker</button><button>Target</button><button>After marker</button>');
    await writeFile(join(dir, "input.html"), '<!doctype html><title>Typing test</title><button autofocus>Before marker</button><label>Query<input></label><button>After marker</button>');
    const record = await replayCase({ id: "unsupported", page: "page.html", chords: ["VO+Right", "Down", "Enter"], axes: {} },
      { id: "test", generatedAt: "", cases: [] }, dir);
    assert.equal(record.start.aligned, true);
    assert.ok(record.unsupportedReason);
    assert.deepEqual(record.steps.map(s => s.reason), ["unsupported", "unsupported", "unsupported"]);
    assert.ok(record.steps.every(s => s.utterances.length === 0));
    const timed = await replayCase({ id: "timed", page: "page.html", chords: ["Tab", "Enter"], listen: { minWaitMs: 2300 }, axes: {} },
      { id: "test", generatedAt: "", cases: [] }, dir);
    assert.match(timed.unsupportedReason!, /timed observation/);
    assert.ok(timed.steps.every(s => s.reason === "unsupported"));
    const typed = await replayCase({ id: "typed", page: "input.html", chords: ["Tab", "c", "a", "t"], axes: {} },
      { id: "test", generatedAt: "", cases: [] }, dir);
    assert.equal(typed.start.aligned, true);
    assert.ok(typed.steps.every(s => s.reason === "quiet"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
