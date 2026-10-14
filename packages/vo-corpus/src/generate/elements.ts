/**
 * elements-v1: one page per common HTML/ARIA element variant, to learn how real VoiceOver announces each role × state × name source.
 * Variants are table rows. `{N}` in a snippet becomes the variant's unique name words ("Red fox"), so names never repeat across pages.
 */
import { END_MARKER, START_MARKER, type Case } from "../cases.js";

interface Variant {
  id: string;
  axes: Record<string, string>;
  html: string;
  /** Estimated VO stops (default 1): "next" presses VO+Right items+2 times; traversal completion is not asserted. */
  items: number;
  /** Target takes keyboard focus: gets the "tab" command. */
  focusable: boolean;
  /** Same-page activation is meaningful: gets the "activate" command. */
  activate: boolean;
}
interface Opts { n?: number; f?: boolean; a?: boolean; axes?: Record<string, string> }

const T = "{N} target";
const variants: Variant[] = [];
const v = (id: string, role: string, state: string, name: string, html: string, o: Opts = {}) =>
  variants.push({ id, axes: { role, state, name, ...o.axes }, html, items: o.n ?? 1, focusable: o.f ?? false, activate: o.a ?? false });

// buttons
v("button-plain", "button", "none", "content", `<button type="button">${T}</button>`, { f: true, a: true });
for (const s of ["true", "false", "mixed"]) v(`button-pressed-${s}`, "button", `pressed-${s}`, "content", `<button type="button" aria-pressed="${s}">${T}</button>`, { f: true, a: true });
for (const s of ["true", "false"]) v(`button-expanded-${s}`, "button", `expanded-${s}`, "content", `<button type="button" aria-expanded="${s}">${T}</button>`, { f: true, a: true });
for (const s of ["menu", "dialog", "listbox"]) v(`button-haspopup-${s}`, "button", `haspopup-${s}`, "content", `<button type="button" aria-haspopup="${s}">${T}</button>`, { f: true, a: true });
v("button-disabled", "button", "disabled", "content", `<button type="button" disabled>${T}</button>`);
v("button-aria-disabled", "button", "aria-disabled", "content", `<button type="button" aria-disabled="true">${T}</button>`, { f: true });
v("button-submit-form", "button", "submit", "content", `<form><button type="submit">${T}</button></form>`, { f: true });
v("button-aria-label", "button", "none", "aria-label", `<button type="button" aria-label="${T}">X</button>`, { f: true, a: true });
v("button-input-type", "button", "none", "value", `<input type="button" value="${T}">`, { f: true, a: true });
v("button-role-div", "button", "none", "content", `<div role="button" tabindex="0">${T}</div>`, { f: true, a: true });
v("button-title-only", "button", "none", "title", `<button type="button" title="${T}"></button>`, { f: true, a: true });

// links
v("link-plain", "link", "none", "content", `<a href="#dest">${T}</a><p id="dest">Destination text</p>`, { f: true, a: true });
v("link-external", "link", "external-href", "content", `<a href="https://example.invalid/">${T}</a>`, { f: true });
v("link-current-page", "link", "aria-current-page", "content", `<a href="#dest" aria-current="page">${T}</a><p id="dest">Destination text</p>`, { f: true, a: true });
v("link-title", "link", "title", "content", `<a href="#dest" title="Extra title">${T}</a><p id="dest">Destination text</p>`, { f: true, a: true });
v("link-image-alt", "link", "none", "img-alt", `<a href="#dest"><img alt="${T}" src="${"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="}"></a><p id="dest">Destination text</p>`, { f: true, a: true });
v("link-skip", "link", "skip-link", "content", `<a href="#skipdest">${T}</a><div id="skipdest" tabindex="-1">Skipped to here</div>`, { f: true, a: true });
v("link-aria-label", "link", "none", "aria-label", `<a href="#dest" aria-label="${T}">More</a><p id="dest">Destination text</p>`, { f: true, a: true });
v("link-no-href", "link", "no-href", "content", `<a>${T}</a>`);
v("link-role-span", "link", "none", "content", `<span role="link" tabindex="0">${T}</span>`, { f: true });

// checkbox, radio, switch
v("checkbox-unchecked", "checkbox", "unchecked", "label-wrap", `<label><input type="checkbox"> ${T}</label>`, { f: true, a: true });
v("checkbox-checked", "checkbox", "checked", "label-wrap", `<label><input type="checkbox" checked> ${T}</label>`, { f: true, a: true });
v("checkbox-indeterminate", "checkbox", "mixed", "aria-label", `<div role="checkbox" aria-checked="mixed" tabindex="0" aria-label="${T}"></div>`, { f: true, a: true });
v("checkbox-disabled", "checkbox", "disabled", "label-for", `<input type="checkbox" id="c" disabled><label for="c">${T}</label>`);
v("checkbox-required", "checkbox", "required", "label-for", `<input type="checkbox" id="c" required><label for="c">${T}</label>`, { f: true, a: true });
v("checkbox-aria-label", "checkbox", "unchecked", "aria-label", `<input type="checkbox" aria-label="${T}">`, { f: true, a: true });
v("checkbox-no-name", "checkbox", "unchecked", "none", `<input type="checkbox">`, { f: true, a: true });
v("checkbox-role-checked", "checkbox", "checked", "aria-label", `<div role="checkbox" aria-checked="true" tabindex="0" aria-label="${T}"></div>`, { f: true, a: true });
v("radio-fieldset", "radiogroup", "one-checked", "legend", `<fieldset><legend>${T}</legend><label><input type="radio" name="g" checked> {N} one</label><label><input type="radio" name="g"> {N} two</label><label><input type="radio" name="g"> {N} three</label></fieldset>`, { n: 4, f: true, a: true });
v("radio-role-group", "radiogroup", "one-checked", "aria-label", `<div role="radiogroup" aria-label="${T}"><div role="radio" aria-checked="true" tabindex="0">{N} one</div><div role="radio" aria-checked="false" tabindex="-1">{N} two</div><div role="radio" aria-checked="false" tabindex="-1">{N} three</div></div>`, { n: 3, f: true, a: true });
v("radio-single-unchecked", "radio", "unchecked", "label-wrap", `<label><input type="radio" name="s"> ${T}</label>`, { f: true, a: true });
v("radio-disabled", "radio", "disabled", "label-wrap", `<label><input type="radio" name="s" disabled> ${T}</label>`);
v("switch-on", "switch", "on", "aria-label", `<div role="switch" aria-checked="true" tabindex="0" aria-label="${T}"></div>`, { f: true, a: true });
v("switch-off", "switch", "off", "aria-label", `<div role="switch" aria-checked="false" tabindex="0" aria-label="${T}"></div>`, { f: true, a: true });
v("switch-input", "switch", "off", "label-wrap", `<label><input type="checkbox" role="switch"> ${T}</label>`, { f: true, a: true });
v("switch-button", "switch", "on", "content", `<button type="button" role="switch" aria-checked="true">${T}</button>`, { f: true, a: true });

// text inputs: type × name source
const inputTypes = ["text", "email", "password", "search", "number", "tel", "url", "date"];
const nameSources: [string, (t: string) => string][] = [
  ["label-for", t => `<label for="i">${T}</label><input id="i" type="${t}">`],
  ["label-wrap", t => `<label>${T} <input type="${t}"></label>`],
  ["aria-label", t => `<input type="${t}" aria-label="${T}">`],
  ["aria-labelledby", t => `<span id="l">${T}</span><input type="${t}" aria-labelledby="l">`],
  ["title", t => `<input type="${t}" title="${T}">`],
  ["placeholder", t => `<input type="${t}" placeholder="${T}">`],
  ["none", t => `<input type="${t}">`],
];
for (const t of inputTypes) for (const [src, html] of nameSources) v(`input-${t}-${src}`, `input-${t}`, "empty", src, html(t), { f: true });
const labeled = `<label for="i">${T}</label>`;
v("input-text-required", "input-text", "required", "label-for", `${labeled}<input id="i" type="text" required>`, { f: true });
v("input-text-aria-required", "input-text", "aria-required", "label-for", `${labeled}<input id="i" type="text" aria-required="true">`, { f: true });
v("input-text-invalid", "input-text", "aria-invalid", "label-for", `${labeled}<input id="i" type="text" aria-invalid="true">`, { f: true });
v("input-text-readonly", "input-text", "readonly", "label-for", `${labeled}<input id="i" type="text" readonly value="Fixed value">`, { f: true });
v("input-text-disabled", "input-text", "disabled", "label-for", `${labeled}<input id="i" type="text" disabled>`);
v("input-text-describedby", "input-text", "described", "label-for", `${labeled}<input id="i" type="text" aria-describedby="h"><p id="h">Hint for {N}</p>`, { n: 2, f: true });
v("input-text-prefilled", "input-text", "prefilled", "label-for", `${labeled}<input id="i" type="text" value="Filled value">`, { f: true });
v("input-email-invalid-required", "input-email", "required+invalid", "label-for", `${labeled}<input id="i" type="email" required aria-invalid="true" value="not-an-email">`, { f: true });
v("input-number-prefilled", "input-number", "prefilled", "label-for", `${labeled}<input id="i" type="number" value="42" min="0" max="100">`, { f: true });
v("input-date-prefilled", "input-date", "prefilled", "label-for", `${labeled}<input id="i" type="date" value="2026-03-14">`, { f: true });
v("textarea-label", "textarea", "empty", "label-for", `${labeled.replace('for="i"', 'for="t"')}<textarea id="t"></textarea>`, { f: true });
v("textarea-prefilled", "textarea", "prefilled", "label-for", `<label for="t">${T}</label><textarea id="t">Line one\nLine two</textarea>`, { f: true });
v("textarea-placeholder", "textarea", "empty", "placeholder", `<textarea placeholder="${T}"></textarea>`, { f: true });
v("textarea-required-readonly", "textarea", "required+readonly", "aria-label", `<textarea aria-label="${T}" required readonly>Fixed text</textarea>`, { f: true });

// select family, range, spinbutton, progress, meter
const opts = `<option>{N} a</option><option>{N} b</option><option>{N} c</option>`;
v("select-single", "combobox", "single", "label-for", `<label for="s">${T}</label><select id="s">${opts}</select>`, { f: true });
v("select-selected-b", "combobox", "single-b-selected", "label-for", `<label for="s">${T}</label><select id="s"><option>{N} a</option><option selected>{N} b</option><option>{N} c</option></select>`, { f: true });
v("select-listbox-size", "listbox", "size-3", "label-for", `<label for="s">${T}</label><select id="s" size="3">${opts}</select>`, { n: 4, f: true });
v("select-multiple", "listbox", "multiple", "label-for", `<label for="s">${T}</label><select id="s" multiple>${opts.replace("<option>", "<option selected>")}</select>`, { n: 4, f: true });
v("select-disabled", "combobox", "disabled", "aria-label", `<select aria-label="${T}" disabled>${opts}</select>`);
v("select-optgroup", "combobox", "optgroup", "aria-label", `<select aria-label="${T}"><optgroup label="{N} group"><option>{N} a</option><option>{N} b</option></optgroup></select>`, { f: true });
v("range-slider", "slider", "value-50", "label-for", `<label for="r">${T}</label><input id="r" type="range" min="0" max="100" value="50">`, { f: true });
v("range-slider-step", "slider", "value-3-of-10", "aria-label", `<input type="range" min="0" max="10" step="1" value="3" aria-label="${T}">`, { f: true });
v("slider-role", "slider", "valuetext", "aria-label", `<div role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="10" aria-valuenow="4" aria-valuetext="Four of ten" aria-label="${T}"></div>`, { f: true });
v("spinbutton-role", "spinbutton", "value-5", "aria-label", `<div role="spinbutton" tabindex="0" aria-valuemin="0" aria-valuemax="10" aria-valuenow="5" aria-label="${T}"></div>`, { f: true });
v("progress-value", "progressbar", "value-40", "aria-label", `<progress value="40" max="100" aria-label="${T}"></progress>`);
v("progress-indeterminate", "progressbar", "indeterminate", "aria-label", `<progress aria-label="${T}"></progress>`);
v("progress-role", "progressbar", "value-70", "aria-label", `<div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="70" aria-label="${T}"></div>`);
v("meter-value", "meter", "value-6-of-10", "aria-label", `<meter min="0" max="10" value="6" aria-label="${T}"></meter>`);

// headings
for (let i = 1; i <= 6; i++) v(`heading-h${i}`, "heading", `level-${i}`, "content", `<h${i}>${T}</h${i}>`);
for (let i = 1; i <= 6; i++) v(`heading-role-level-${i}`, "heading", `level-${i}`, "content", `<div role="heading" aria-level="${i}">${T}</div>`, { axes: { source: "role" } });
v("heading-with-link", "heading", "level-2", "content", `<h2><a href="#dest">${T}</a></h2><p id="dest">Destination text</p>`, { f: true, a: true });

// images
const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
v("img-alt", "img", "alt", "alt", `<img src="${gif}" alt="${T}">`);
v("img-empty-alt", "img", "empty-alt", "none", `<img src="${gif}" alt=""><p>{N} after image</p>`, { n: 2 });
v("img-no-alt", "img", "no-alt", "none", `<img src="${gif}"><p>{N} after image</p>`, { n: 2 });
v("img-role-aria-label", "img", "none", "aria-label", `<div role="img" aria-label="${T}"></div>`);
v("img-svg-title", "img", "svg-title", "title", `<svg width="20" height="20" role="img"><title>${T}</title><circle cx="10" cy="10" r="8"/></svg>`);
v("img-svg-aria-label", "img", "svg", "aria-label", `<svg width="20" height="20" role="img" aria-label="${T}"><circle cx="10" cy="10" r="8"/></svg>`);
v("img-svg-decorative", "img", "svg-aria-hidden", "none", `<svg width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="8"/></svg><p>{N} after svg</p>`, { n: 2 });
v("img-title-only", "img", "title-only", "title", `<img src="${gif}" alt="" title="${T}">`);
v("figure-caption", "figure", "figcaption", "figcaption", `<figure><img src="${gif}" alt="{N} picture"><figcaption>${T}</figcaption></figure>`, { n: 3 });

// lists
v("list-ul", "list", "3-items", "none", `<ul><li>{N} one</li><li>{N} two</li><li>{N} three</li></ul>`, { n: 4 });
v("list-ol", "list", "3-items-ordered", "none", `<ol><li>{N} one</li><li>{N} two</li><li>{N} three</li></ol>`, { n: 4 });
v("list-nested", "list", "nested", "none", `<ul><li>{N} outer<ul><li>{N} inner one</li><li>{N} inner two</li></ul></li><li>{N} last</li></ul>`, { n: 6 });
v("list-dl", "list", "description-list", "none", `<dl><dt>{N} term</dt><dd>{N} definition</dd><dt>{N} term two</dt><dd>{N} definition two</dd></dl>`, { n: 5 });
v("list-ul-links", "list", "links", "content", `<ul><li><a href="#dest">{N} one</a></li><li><a href="#dest">{N} two</a></li></ul><p id="dest">Destination text</p>`, { n: 3, f: true, a: true });
v("list-role-list", "list", "role-list", "none", `<ul role="list" style="list-style:none"><li>{N} one</li><li>{N} two</li></ul>`, { n: 3 });

// tables
v("table-simple", "table", "2x2-th-header-row", "caption", `<table><caption>${T}</caption><tr><th>{N} h1</th><th>{N} h2</th></tr><tr><td>{N} a</td><td>{N} b</td></tr></table>`, { n: 6 });
v("table-row-headers", "table", "row-and-col-headers", "caption", `<table><caption>${T}</caption><tr><td></td><th scope="col">{N} c1</th><th scope="col">{N} c2</th></tr><tr><th scope="row">{N} r1</th><td>{N} a</td><td>{N} b</td></tr></table>`, { n: 8 });
v("table-no-caption", "table", "2x2-no-caption", "none", `<table><tr><th>{N} h1</th><th>{N} h2</th></tr><tr><td>{N} a</td><td>{N} b</td></tr></table>`, { n: 5 });
v("table-aria-label", "table", "2x2", "aria-label", `<table aria-label="${T}"><tr><th>{N} h1</th><th>{N} h2</th></tr><tr><td>{N} a</td><td>{N} b</td></tr></table>`, { n: 6 });
v("table-colspan", "table", "colspan", "caption", `<table><caption>${T}</caption><tr><th colspan="2">{N} wide</th></tr><tr><td>{N} a</td><td>{N} b</td></tr></table>`, { n: 5 });
v("table-role-grid", "grid", "2x2", "aria-label", `<div role="grid" aria-label="${T}"><div role="row"><span role="columnheader">{N} h1</span><span role="columnheader">{N} h2</span></div><div role="row"><span role="gridcell">{N} a</span><span role="gridcell">{N} b</span></div></div>`, { n: 6 });

// landmarks
const lm = (id: string, role: string, name: string, html: string, n = 1) => v(`landmark-${id}`, role, "none", name, html, { n: n + 1 });
lm("nav", "navigation", "aria-label", `<nav aria-label="${T}"><a href="#dest">{N} link</a></nav><p id="dest">Destination text</p>`);
lm("nav-no-name", "navigation", "none", `<nav><a href="#dest">{N} link</a></nav><p id="dest">Destination text</p>`);
lm("main", "main", "aria-label", `<main aria-label="${T}"><p>{N} inside</p></main>`);
lm("header", "banner", "aria-label", `<header aria-label="${T}"><p>{N} inside</p></header>`);
lm("footer", "contentinfo", "aria-label", `<footer aria-label="${T}"><p>{N} inside</p></footer>`);
lm("aside", "complementary", "aria-label", `<aside aria-label="${T}"><p>{N} inside</p></aside>`);
lm("aside-no-name", "complementary", "none", `<aside><p>{N} inside</p></aside>`);
lm("section-region", "region", "aria-label", `<section aria-label="${T}"><p>{N} inside</p></section>`);
lm("section-no-name", "generic", "none", `<section><p>{N} inside</p></section>`);
lm("form-named", "form", "aria-label", `<form aria-label="${T}"><label>{N} field <input type="text"></label></form>`, 2);
lm("form-no-name", "generic", "none", `<form><label>{N} field <input type="text"></label></form>`, 2);
lm("search-role", "search", "aria-label", `<div role="search" aria-label="${T}"><label>{N} query <input type="search"></label></div>`, 2);
lm("search-element", "search", "aria-label", `<search aria-label="${T}"><label>{N} query <input type="search"></label></search>`, 2);
lm("role-banner-div", "banner", "aria-label", `<div role="banner" aria-label="${T}"><p>{N} inside</p></div>`);
lm("group-labelled", "group", "aria-label", `<div role="group" aria-label="${T}"><p>{N} inside</p></div>`);

// disclosure, dialogs, live regions
v("details-closed", "group", "details-closed", "summary", `<details><summary>${T}</summary><p>{N} hidden body</p></details>`, { f: true, a: true });
v("details-open", "group", "details-open", "summary", `<details open><summary>${T}</summary><p>{N} shown body</p></details>`, { n: 2, f: true, a: true });
v("dialog-element-open", "dialog", "open-non-modal", "aria-label", `<dialog open aria-label="${T}"><p>{N} dialog text</p></dialog>`, { n: 2 });
v("dialog-role", "dialog", "none", "aria-label", `<div role="dialog" aria-label="${T}"><p>{N} dialog text</p></div>`, { n: 2 });
v("dialog-role-labelledby", "dialog", "none", "aria-labelledby", `<div role="dialog" aria-labelledby="t"><h2 id="t">${T}</h2><p>{N} dialog text</p></div>`, { n: 3 });
v("alertdialog-role", "alertdialog", "none", "aria-label", `<div role="alertdialog" aria-label="${T}"><p>{N} alert text</p></div>`, { n: 2 });
v("alert-static", "alert", "static-text", "content", `<div role="alert">${T}</div>`);
v("status-static", "status", "static-text", "content", `<div role="status">${T}</div>`);
v("live-polite", "region", "aria-live-polite", "content", `<div aria-live="polite">${T}</div>`);
v("log-role", "log", "static-text", "aria-label", `<div role="log" aria-label="{N} log"><p>${T}</p></div>`, { n: 2 });
v("tooltip-role", "tooltip", "static-text", "content", `<div role="tooltip">${T}</div>`);

// composite widgets
v("tablist", "tablist", "one-selected", "aria-label", `<div role="tablist" aria-label="{N} tabs"><button type="button" role="tab" aria-selected="true" aria-controls="p1" id="t1">{N} one</button><button type="button" role="tab" aria-selected="false" aria-controls="p2" id="t2" tabindex="-1">{N} two</button><button type="button" role="tab" aria-selected="false" aria-controls="p3" id="t3" tabindex="-1">{N} three</button></div><div role="tabpanel" id="p1" aria-labelledby="t1"><p>{N} panel text</p></div>`, { n: 5, f: true, a: true });
v("tabpanel-only", "tabpanel", "none", "aria-label", `<div role="tabpanel" aria-label="${T}"><p>{N} panel text</p></div>`, { n: 2 });
v("menu-role", "menu", "none", "aria-label", `<div role="menu" aria-label="{N} menu"><div role="menuitem" tabindex="0">{N} one</div><div role="menuitem" tabindex="-1">{N} two</div><div role="menuitemcheckbox" aria-checked="true" tabindex="-1">{N} three</div></div>`, { n: 3, f: true });
v("menubar-role", "menubar", "none", "aria-label", `<div role="menubar" aria-label="{N} bar"><div role="menuitem" tabindex="0">{N} one</div><div role="menuitem" tabindex="-1">{N} two</div></div>`, { n: 2, f: true });
v("listbox-role", "listbox", "one-selected", "aria-label", `<div role="listbox" aria-label="{N} list" tabindex="0"><div role="option" aria-selected="false">{N} one</div><div role="option" aria-selected="true">{N} two</div><div role="option" aria-selected="false">{N} three</div></div>`, { n: 4, f: true });
v("combobox-collapsed", "combobox", "expanded-false", "aria-label", `<input type="text" role="combobox" aria-expanded="false" aria-controls="lb" aria-label="${T}" aria-autocomplete="list"><ul id="lb" role="listbox" hidden><li role="option">{N} one</li></ul>`, { f: true });
v("combobox-datalist", "combobox", "datalist", "label-for", `<label for="d">${T}</label><input id="d" list="dl"><datalist id="dl"><option value="{N} one"><option value="{N} two"></datalist>`, { f: true });
v("tree-role", "tree", "minimal", "aria-label", `<ul role="tree" aria-label="{N} tree"><li role="treeitem" aria-expanded="true" tabindex="0">{N} parent<ul role="group"><li role="treeitem" tabindex="-1">{N} child</li></ul></li><li role="treeitem" tabindex="-1">{N} sibling</li></ul>`, { n: 3, f: true });
v("toolbar-role", "toolbar", "none", "aria-label", `<div role="toolbar" aria-label="{N} tools"><button type="button">{N} one</button><button type="button">{N} two</button></div>`, { n: 3, f: true, a: true });
v("iframe-title", "iframe", "button-inside", "title", `<iframe title="${T}" srcdoc='<button type="button">{N} inner</button>'></iframe>`, { n: 3, f: true });
v("iframe-no-title", "iframe", "button-inside", "none", `<iframe srcdoc='<button type="button">{N} inner</button>'></iframe>`, { n: 3, f: true });

// inline and plain text
const p = (id: string, role: string, state: string, html: string, o: Opts = {}) => v(id, role, state, "content", html, o);
p("text-paragraph", "paragraph", "plain", `<p>${T} plain paragraph.</p>`);
p("text-emphasis", "text", "em", `<p>Some <em>${T}</em> text.</p>`);
p("text-strong", "text", "strong", `<p>Some <strong>${T}</strong> text.</p>`);
p("text-link-inside", "link", "inside-paragraph", `<p>Before <a href="#dest">${T}</a> after.</p><p id="dest">Destination text</p>`, { f: true, a: true });
p("text-abbr", "text", "abbr-title", `<p>The <abbr title="World Wide Web">WWW</abbr> {N} text.</p>`);
p("text-code", "text", "code", `<p>Run <code>${T}</code> now.</p>`);
p("text-mark", "text", "mark", `<p>A <mark>${T}</mark> phrase.</p>`);
p("text-del-ins", "text", "del+ins", `<p>Was <del>{N} old</del> now <ins>{N} new</ins>.</p>`);
p("text-sub-sup", "text", "sub+sup", `<p>H<sub>2</sub>O and x<sup>2</sup> {N} text.</p>`);
p("text-q-cite", "text", "q", `<p>She said <q>${T}</q> loudly.</p>`);
p("text-kbd", "text", "kbd", `<p>Press <kbd>Ctrl</kbd> {N} text.</p>`);
p("text-time", "text", "time", `<p>Meet at <time datetime="2026-03-14T09:30">${T}</time>.</p>`);
p("text-blockquote", "blockquote", "none", `<blockquote><p>${T} quoted words.</p></blockquote>`, { n: 2 });
p("text-hr", "separator", "hr", `<p>{N} above</p><hr><p>{N} below</p>`, { n: 3 });
p("text-pre", "text", "pre", `<pre>line one ${T}\n  line two</pre>`);
p("text-aria-hidden", "text", "aria-hidden-sibling", `<p><span aria-hidden="true">{N} hidden</span> ${T} visible</p>`);
p("text-aria-hidden-block", "text", "aria-hidden-block", `<p aria-hidden="true">{N} hidden</p><p>${T} visible</p>`);
p("text-visually-hidden", "text", "clip-hidden", `<p>Visible <span style="position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">{N} hidden</span> ${T}</p>`);
p("text-display-none", "text", "display-none", `<p style="display:none">{N} gone</p><p>${T} visible</p>`);
p("text-korean-mixed", "text", "ko+en", `<p>한국어와 English가 섞인 ${T} 문장입니다.</p>`);
p("text-korean-lang", "text", "lang-ko", `<p lang="ko">${T} 안녕하세요, 반갑습니다.</p>`);
p("text-numbers", "text", "numbers", `<p>${T} costs 1,234.50 dollars, 3 of 10 items, 50%.</p>`);
p("text-dates", "text", "dates", `<p>${T} on 2026-03-14, 03/14/2026, 9:30 AM.</p>`);
p("text-punctuation", "text", "punctuation", `<p>${T}: wait... really?! (yes) - "ok"; a/b &amp; c_d.</p>`);
p("text-url-email", "text", "url+email", `<p>${T} at https://example.com/a?b=1 or me@example.com.</p>`);
p("text-long-sentences", "paragraph", "multi-sentence", `<p>${T} first sentence here. Second sentence follows it. Third one ends the paragraph.</p>`);

const words = ["Red", "Blue", "Green", "Gold", "Pink", "Gray", "Teal", "Plum", "Jade", "Rust", "Navy", "Lime", "Rose", "Ruby", "Sand", "Snow", "Mint", "Ink", "Sky", "Fire"];
const animals = ["fox", "owl", "cat", "bee", "elk", "ant", "yak", "emu", "ram", "hen", "eel", "bat", "cow", "dog", "pig", "rat", "ape", "gnu", "jay", "koi"];

const pageHtml = (id: string, snippet: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${id}</title></head><body><button type="button" autofocus>${START_MARKER}</button>${snippet}<button type="button">${END_MARKER}</button></body></html>`;

/** Pages (variant id → html) and cases, in table order. */
export function generateElements() {
  const pages: Record<string, string> = {};
  const cases: Case[] = [];
  variants.forEach((x, i) => {
    if (pages[x.id]) throw new Error(`Duplicate variant id ${x.id}`);
    const name = `${words[i % words.length]} ${animals[Math.floor(i / words.length) % animals.length]}`;
    pages[x.id] = pageHtml(x.id, x.html.replaceAll("{N}", name));
    const add = (command: string, chords: string[]) =>
      cases.push({ id: `${x.id}.${command}`, page: `pages/${x.id}.html`, chords, axes: { ...x.axes, command } });
    add("next", [...Array(x.items + 2).fill("VO+Right"), "VO+Left"]);
    if (x.focusable) add("tab", ["Tab", "Shift+Tab"]);
    if (x.activate) add("activate", ["VO+Right", "VO+Space"]);
  });
  return { pages, cases };
}
