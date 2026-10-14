import assert from "node:assert/strict";
import test from "node:test";
import { generatePagePatterns } from "../src/generate/page-patterns.js";

test("live-page followups preserve image/text contrasts and styled-list semantics", () => {
  const { cases, pages } = generatePagePatterns();
  assert.equal(cases.length, 8);
  assert.equal(new Set(cases.map(c => c.id)).size, 8);
  assert.match(pages["logo-image"]!, /aria-label="Visit Harbor homepage".*alt="Harbor"/);
  assert.match(pages["logo-svg"]!, /svg role="img"/);
  assert.doesNotMatch(pages["logo-text"]!, /<img|<svg/);
  assert.match(pages.breadcrumb!, /role="list" style="list-style:none/);
  for (const c of cases) {
    assert.ok(pages[c.page.slice(6, -5)]);
    assert.equal(c.captureAxAfterSteps, true);
    assert.equal(c.axes.partition, "training");
    assert.equal(c.chords.at(-1), "VO+Left");
  }
});
