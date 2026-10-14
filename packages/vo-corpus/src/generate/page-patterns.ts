import type { Case } from "../cases.js";

/** Reduced questions from live-page divergence, not a replacement for the live sample. */
export function generatePagePatterns() {
  const pages: Record<string, string> = {}, cases: Case[] = [];
  const add = (id: string, family: string, body: string, stops: number) => {
    pages[id] = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Public pattern ${id}</title>
<style>body{font:18px system-ui;padding:20px}button,a{margin:8px}</style><body>
<button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
    cases.push({ id: `page-patterns.${id}`, page: `pages/${id}.html`, chords: [...Array.from({ length: stops }, () => "VO+Right"), "VO+Left"],
      captureAxAfterSteps: true, axes: { family, role: "page-pattern", command: "navigation", partition: "training", reference: "working", source: "reduced-live-page-question" } });
  };
  add("logo-image", "link-image", '<a href="#home" aria-label="Visit Harbor homepage"><img width="40" height="30" alt="Harbor" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2230%22%3E%3Crect width=%2240%22 height=%2230%22 fill=%22navy%22/%3E%3C/svg%3E"></a>', 2);
  add("logo-svg", "link-image", '<a href="#home" aria-label="Visit Harbor homepage"><svg role="img" aria-label="Harbor" width="40" height="30"><rect width="40" height="30" fill="navy"/></svg></a>', 2);
  add("logo-text", "link-image", '<a href="#home">Visit Harbor homepage</a>', 2);
  add("breadcrumb", "list", '<nav aria-label="Breadcrumb"><ol role="list" style="list-style:none;padding:0"><li><a href="#home">Home</a></li><li><a href="#guide" aria-current="page">Guide</a></li></ol></nav>', 8);
  add("one-breadcrumb", "list", '<nav aria-label="Breadcrumb"><ol role="list" style="list-style:none;padding:0"><li><a href="#home">Home</a></li></ol></nav>', 6);
  add("banner-boundary", "landmark", '<header><nav aria-label="Account"><a href="#account">Account</a><button>Settings</button></nav></header><main><h1>Guide</h1></main>', 10);
  add("navigation-heading", "heading", '<nav aria-labelledby="menu-title"><h2 id="menu-title">Navigation menu</h2><button aria-expanded="false">Show navigation menu</button><button aria-expanded="false">Show search menu</button></nav>', 7);
  add("cookie-region", "region", '<section aria-label="Cookies"><h2>Cookies</h2><p>We use essential cookies.</p><button>Accept additional cookies</button><button>Reject additional cookies</button><a href="#cookies">View cookies</a></section><a href="#main">Skip to main content</a>', 9);
  return { pages, cases };
}
