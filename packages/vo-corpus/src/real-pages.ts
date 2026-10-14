/** Public live pages: seeded sampling, read-only object navigation, identical start markers in both browsers. */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { CaseSet } from "./cases.js";
import type { AxDump, AxNode } from "./axdump.js";
import { normalize } from "./compare.js";

export const publicPagePool = [
  { family: "blog", url: "https://blog.mozilla.org/accessibility/hello-world/" },
  { family: "blog", url: "https://developer.mozilla.org/en-US/blog/" },
  { family: "blog", url: "https://blog.mozilla.org/en/latest/" },
  { family: "article", url: "https://en.wikipedia.org/wiki/Computer_accessibility" },
  { family: "article", url: "https://en.wikipedia.org/wiki/Accessibility" },
  { family: "article", url: "https://www.mozilla.org/en-US/impact/" },
  { family: "service", url: "https://www.gov.uk/service-manual/service-assessments/get-your-service-on-govuk" },
  { family: "service", url: "https://www.gov.uk/apply-renew-passport" },
  { family: "service", url: "https://www.gov.uk/check-uk-visa" },
  { family: "search", url: "https://en.wikipedia.org/w/index.php?title=Special:Search&search=accessibility" },
  { family: "search", url: "https://www.gov.uk/search/all?keywords=passport" },
  { family: "shop", url: "https://www.ikea.com/us/en/cat/desks-computer-desks-20649/" },
  { family: "shop", url: "https://www.ikea.com/us/en/cat/bookcases-shelving-units-st002/" },
] as const;

export function samplePublicPages(seed: string, count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > publicPagePool.length) throw new Error(`Page count must be between 1 and ${publicPagePool.length}`);
  // Hash ranking is deterministic and independent of whether a page later succeeds.
  return publicPagePool.map(page => ({ ...page, rank: createHash("sha256").update(seed + "\0" + page.url).digest("hex") })).sort((a, b) => a.rank.localeCompare(b.rank)).slice(0, count);
}

// Only the two harness buttons are added; original page content and handlers stay live.
export const prepareRealPageScript = `(() => {
  if (!document.body || document.readyState === 'loading') throw new Error('Public page is not ready');
  const add = (id, label, first) => {
    let button = document.getElementById(id);
    if (button && (!(button instanceof HTMLButtonElement) || button.getAttribute('data-vo-corpus-marker') !== 'true' || button.textContent !== label)) throw new Error('Public page marker ID collision');
    if (!button) { button = document.createElement('button'); button.id=id; button.textContent=label;
      button.setAttribute('data-vo-corpus-marker','true'); button.style.cssText='display:block!important;visibility:visible!important;position:relative!important;z-index:2147483647!important;font:16px system-ui!important';
      if(first)document.body.prepend(button);else document.body.append(button);
    } return button;
  };
  const before=add('vo-corpus-public-before','Before marker',true);add('vo-corpus-public-after','After marker',false);
  before.focus(); window.scrollTo(0,0);
  const text=document.body.innerText.replace(/\\s+/g,' ').trim();
  return JSON.stringify({url:location.href,title:document.title,width:innerWidth,height:innerHeight,readyState:document.readyState,text});
})()`;

export interface PageContext { url: string; title: string; width: number; height: number; contentSha256: string; textLength: number; sampledAt: string; contentSource?: "accessibility-text"; contentText?: string }
export function realPageContext(raw: string): PageContext {
  const parsed = JSON.parse(raw) as { url: string; title: string; width: number; height: number; text: string };
  if (!/^https:\/\//.test(parsed.url) || !parsed.text || !Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) throw new Error("Invalid public page context");
  if (parsed.text.length < 100 || /^(404|403|page not found|access denied|just a moment|attention required)/i.test(parsed.title)) throw new Error("Public page is empty, unavailable or an access challenge; preserve this failed sample");
  return { url: parsed.url, title: parsed.title, width: parsed.width, height: parsed.height,
    contentSha256: createHash("sha256").update(parsed.text).digest("hex"), textLength: parsed.text.length, sampledAt: new Date().toISOString(), contentText: parsed.text };
}

type Anchor = NonNullable<import("./cases.js").CaseRecord["start"]["anchor"]>;
const nativeControlRoles = new Set(["AXButton","AXLink","AXCheckBox","AXRadioButton","AXTextField","AXTextArea","AXComboBox","AXSlider","AXImage","AXPopUpButton","AXDisclosureTriangle"]);
export function nativeAccessibleText(node: AxNode): string {
  if (node.AXRole === "AXStaticText") return String(node.AXValue || node.AXTitle || "");
  if (nativeControlRoles.has(node.AXRole ?? "") && node.AXTitle) return String(node.AXTitle);
  if (node.AXRole === "AXImage" && node.AXDescription) return String(node.AXDescription);
  return (node.children ?? []).map(nativeAccessibleText).join(" ");
}
export function firstUniqueHeading(dump: AxDump): Anchor {
  if (dump.truncated || dump.stringTruncations) throw new Error("Native accessibility content is truncated");
  const headings: Anchor[] = [];
  const visit = (n: AxNode) => {
    if (n.AXRole === "AXHeading") headings.push({ name: String(n.AXTitle || nativeAccessibleText(n)).trim().replace(/\s+/g," "), ...(typeof n.AXARIALevel === "number" ? {level:n.AXARIALevel} : {}) });
    for (const c of n.children ?? []) visit(c);
  };
  visit(dump.root);
  const anchor = headings.find(h => h.name && headings.filter(other => normalize(other.name) === normalize(h.name)).length === 1);
  if (!anchor) throw new Error("Public page has no unique exposed heading anchor");
  return anchor;
}
export function hearsHeading(speech: string[], anchor: Anchor): boolean {
  return speech.some(text => {
    const match = /^(?:(?:first|last) heading )?(?:link )?heading(?: level ([1-6]))?(?: link)? (.+)$/.exec(normalize(text));
    return !!match && match[2] === normalize(anchor.name) && (anchor.level === undefined || Number(match[1]) === anchor.level);
  });
}
export function accessiblePageContext(text: string, info: { url: string; title: string; width: number; height: number }): PageContext {
  // Engines split inline text differently. Preserve all letters/digits and their order, ignoring formatting boundaries.
  const canonical = text.normalize("NFKC").replace(/[\p{P}\p{S}\p{Z}\s]/gu, "");
  return { ...realPageContext(JSON.stringify({ ...info, text: canonical })), contentSource: "accessibility-text" };
}
export function chromiumAccessibleText(nodes: {nodeId:string;childIds?:string[];parentId?:string;ignored:boolean;role?:{value?:unknown};name?:{value?:unknown}}[]): string {
  const byId = new Map(nodes.map(n => [n.nodeId,n])), seen = new Set<string>();
  const controls = new Set(["button","link","checkbox","radio","textbox","searchbox","combobox","slider","image","popUpButton","DisclosureTriangle"]);
  const visit = (n: typeof nodes[number]): string => {
    if (seen.has(n.nodeId)) return ""; seen.add(n.nodeId);
    if (!n.ignored && (n.role?.value === "StaticText" || controls.has(String(n.role?.value))) && n.name?.value) return String(n.name.value);
    return (n.childIds ?? []).flatMap(id => byId.has(id) ? [visit(byId.get(id)!)] : []).join(" ");
  };
  return nodes.filter(n => !n.parentId || !byId.has(n.parentId)).map(visit).join(" ");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({ options: { out: { type: "string" }, seed: { type: "string" }, count: { type: "string", default: "8" }, width: { type: "string" }, height: { type: "string" }, "first-heading": {type:"boolean"} } });
  if (!values.out || !values.width || !values.height) throw new Error("Usage: real-pages.ts --out <directory> --width <Safari width> --height <Safari height> [--seed value] [--count 8]");
  const viewport = { width: Number(values.width), height: Number(values.height) };
  if (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) || viewport.width < 1 || viewport.height < 1) throw new Error("Invalid viewport");
  const seed = values.seed ?? randomBytes(16).toString("hex"), chosen = samplePublicPages(seed, Number(values.count)), generatedAt = new Date().toISOString();
  const set: CaseSet = { id: `public-pages-${seed}${values["first-heading"] ? "-first-heading" : ""}`, generatedAt,
    cases: chosen.map((p, i) => ({ id: `public.${i + 1}.${p.family}`, page: "", url: p.url, viewport,
      chords: [...Array.from({ length: 24 }, () => "VO+Right"), "VO+Cmd+H", "VO+Cmd+H", "VO+Left", "Tab", "Tab", "Shift+Tab"],
      ...(values["first-heading"] ? {startProtocol:"first-heading" as const} : {}),
      captureAxAfterSteps: !values["first-heading"], axes: { family: p.family, role: "real-page", command: "read-only-navigation", partition: "validation", source: "live-public-page" } })) };
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "cases.json"), JSON.stringify(set, null, 2), { flag: "wx" });
  await writeFile(join(out, "sampling.json"), JSON.stringify({ seed, generatedAt, pool: publicPagePool, selected: chosen, protocol: values["first-heading"] ? "First unique native AX heading anchors both browsers without modifying the page or enabling Safari JavaScript automation. Samples body reading after that heading, not the earlier header. AX-text fingerprints are conservative; engine/content differences remain failures. No replacement of failed samples." : "Fixed candidates, seeded hash ranking before collection. No replacement of failed pages; navigation only. Adds two fixture markers. Pages remain live; hashes and viewports must match before scoring speech as a match." }, null, 2), { flag: "wx" });
  console.log(`${chosen.length} seeded public pages -> ${out}`);
}
