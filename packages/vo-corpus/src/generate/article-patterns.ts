import type { Case } from "../cases.js";

/** Isolate linked headings and article cards exposed by MDN's native/model divergence. */
export function generateArticlePatterns() {
  const pages: Record<string,string> = {}, cases: Case[] = [];
  const image = '<img width="40" height="30" alt="Harbor skyline" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2230%22%3E%3Crect width=%2240%22 height=%2230%22 fill=%22navy%22/%3E%3C/svg%3E">';
  const headings = {
    inside: '<h2><a href="#destination">Harbor guide</a></h2>',
    outside: '<a href="#destination"><h2>Harbor guide</h2></a>',
    partial: '<h2>Harbor <a href="#destination">guide</a></h2>',
    rich: '<h2><a href="#destination"><span>Harbor</span> <em>guide</em></a></h2>',
  };
  const add = (id: string, family: string, body: string, chords: string[]) => {
    pages[id] = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Article question ${id}</title>
<style>body{font:18px system-ui;padding:20px}button,a{margin:8px}</style><body>
<button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
    cases.push({ id: `article-patterns.${id}`, page: `pages/${id}.html`, chords, captureAxAfterSteps: true,
      axes: { family, role: "article-pattern", command: "navigation", partition: "training", reference: "reduced-live-page-question" } });
  };
  const navigation = (count: number) => [...Array.from({length:count},()=>"VO+Right"),"VO+Left"];
  for (const [kind,heading] of Object.entries(headings)) add(`heading-${kind}`,"linked-heading",heading,navigation(5));
  const content = `${headings.inside}<p>A route along the waterfront.</p><p>Written by <a href="#author">Mira Chen</a>.</p>`;
  add("article-plain","article",`<article>${content}</article>`,navigation(10));
  add("article-labelled","article",`<article aria-labelledby="card-title"><h2 id="card-title"><a href="#destination">Harbor guide</a></h2><p>A route along the waterfront.</p></article>`,navigation(9));
  add("article-card","article",`<article><a href="#destination" aria-label="Harbor guide">${image}</a>${content}<time datetime="2026-10-01">October 1, 2026</time></article>`,navigation(12));
  add("article-figure","article",`<article><figure>${image}<figcaption>Evening at the harbor</figcaption></figure>${content}</article>`,navigation(12));
  for (const kind of ["inside","outside"] as const) {
    const body = `${headings[kind]}<p>Introduction before the destination.</p><p id="destination">Destination reached.</p><h2>Travel details</h2>`;
    add(`jump-${kind}`,"linked-heading-jump",body,["VO+Cmd+H","VO+Right","VO+Left","VO+Cmd+H","VO+Right"]);
    add(`activate-${kind}`,"linked-heading-activation",body,["VO+Cmd+H","VO+Space","VO+Right","VO+Left"]);
  }
  return {pages,cases};
}
