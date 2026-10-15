/** Public live pages: seeded sampling, read-only object navigation, identical start markers in both browsers. */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export function samplePublicPages(seed: string, count: number, pool:readonly {family:string;url:string}[]=publicPagePool) {
  if(!Array.isArray(pool)||pool.some(p=>!p||typeof p.family!=='string'||!p.family.trim()||typeof p.url!=='string'||!URL.canParse(p.url)||new URL(p.url).protocol!=='https:'||new URL(p.url).username||new URL(p.url).password)||new Set(pool.map(p=>p.url)).size!==pool.length)throw new Error('Pool must contain unique HTTPS candidates with family labels');
  if (!Number.isSafeInteger(count) || count < 1 || count > pool.length) throw new Error(`Page count must be between 1 and ${pool.length}`);
  // Hash ranking is deterministic and independent of whether a page later succeeds.
  return pool.map(page => ({ ...page, rank: createHash("sha256").update(seed + "\0" + page.url).digest("hex") })).sort((a, b) => a.rank.localeCompare(b.rank)).slice(0, count);
}

// Only the two harness buttons are added; original page content and handlers stay live.
export function publicPageScript(protocol?: "visible-dom-v1"): string { return `(() => {
  if (!document.body || document.readyState === 'loading') throw new Error('Public page is not ready');
  const add = (id, label, first) => {
    let button = document.getElementById(id);
    if (button && (!(button instanceof HTMLButtonElement) || button.getAttribute('data-vo-corpus-marker') !== 'true' || button.textContent !== label)) throw new Error('Public page marker ID collision');
    if (!button) { button = document.createElement('button'); button.id=id; button.textContent=label;
      button.setAttribute('data-vo-corpus-marker','true'); button.style.cssText='display:block!important;visibility:visible!important;position:${protocol === "visible-dom-v1" ? "fixed" : "relative"}!important;z-index:2147483647!important;font:16px system-ui!important'+(${protocol === "visible-dom-v1"}?(first?';top:0!important;left:0!important':';bottom:0!important;right:0!important'):'');
      if(first)document.body.prepend(button);else document.body.append(button);
    } return button;
  };
  const before=add('vo-corpus-public-before','Before marker',true);add('vo-corpus-public-after','After marker',false);
  before.focus(); window.scrollTo(0,0);
  const text=document.body.innerText.replace(/\\s+/g,' ').trim();
  let domSnapshot;
  if (${protocol === "visible-dom-v1"}) {
    const walk = node => {
      if(node.nodeType===Node.TEXT_NODE)return ['text',node.nodeValue.replace(/\\s+/g,' ')];
      if(node.nodeType!==Node.ELEMENT_NODE)return null;
      const tag=node.localName;
      if(['script','style','template','noscript'].includes(tag)||node.getAttribute('data-vo-corpus-marker')==='true'||node instanceof HTMLInputElement&&node.type==='hidden')return null;
      const style=getComputedStyle(node);
      const attrs=Array.from(node.attributes,a=>[a.name,a.value]).filter(a=>!(node instanceof HTMLInputElement&&node.type==='password'&&a[0]==='value')).sort((a,b)=>a[0].localeCompare(b[0]));
      const state=node instanceof HTMLInputElement ? {checked:node.checked,...(node.type==='password'?{}:{value:node.value})} : node instanceof HTMLTextAreaElement||node instanceof HTMLSelectElement ? {value:node.value} : null;
      return [tag,attrs,{hidden:style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse',listStyle:style.listStyleType,before:getComputedStyle(node,'::before').content,after:getComputedStyle(node,'::after').content},state,Array.from(node.childNodes,walk).filter(x=>x!==null),node.shadowRoot?Array.from(node.shadowRoot.childNodes,walk).filter(x=>x!==null):null];
    };
    domSnapshot=JSON.stringify(walk(document.body));
    if(domSnapshot.length>4*1024*1024)throw new Error('Public DOM fingerprint input exceeds 4 MiB; preserve failed sample');
  }
  return JSON.stringify({url:location.href,title:document.title,width:innerWidth,height:innerHeight,readyState:document.readyState,text,...(domSnapshot?{domSnapshot,contentSource:'visible-dom-v1'}:{})});
})()`; }
export const prepareRealPageScript = publicPageScript();

export interface PageContext { url: string; title: string; width: number; height: number; contentSha256: string; textLength: number; sampledAt: string; contentSource?: "accessibility-text" | "visible-dom-v1"; contentText?: string; domSnapshot?: string; renderedTextSha256?: string; harnessSha256?: string }
export function realPageContext(raw: string, scriptSource?: string): PageContext {
  const parsed = JSON.parse(raw) as { url: string; title: string; width: number; height: number; text: string; contentSource?: string; domSnapshot?: string };
  if (!/^https:\/\//.test(parsed.url) || !parsed.text || !Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) throw new Error("Invalid public page context");
  if (parsed.text.length < 100 || /^(404|403|page not found|access denied|just a moment|attention required)/i.test(parsed.title)) throw new Error("Public page is empty, unavailable or an access challenge; preserve this failed sample");
  if (parsed.contentSource !== undefined && parsed.contentSource !== "visible-dom-v1") throw new Error("Unknown public content fingerprint protocol");
  if (parsed.contentSource && (!parsed.domSnapshot || parsed.domSnapshot.length > 4*1024*1024 || !Array.isArray(JSON.parse(parsed.domSnapshot)))) throw new Error("Missing or invalid public DOM fingerprint input");
  if (parsed.contentSource && !scriptSource) throw new Error("DOM fingerprint requires the capture script source for provenance");
  const renderedTextSha256 = createHash("sha256").update(parsed.text).digest("hex");
  return { url: parsed.url, title: parsed.title, width: parsed.width, height: parsed.height,
    contentSha256: parsed.contentSource ? createHash("sha256").update(parsed.domSnapshot!).digest("hex") : renderedTextSha256,
    textLength: parsed.text.length, sampledAt: new Date().toISOString(), contentText: parsed.text,
    ...(parsed.contentSource ? {contentSource:"visible-dom-v1",domSnapshot:parsed.domSnapshot,renderedTextSha256,harnessSha256:createHash("sha256").update(scriptSource!).digest("hex")} : {}) };
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
  const { values } = parseArgs({ options: { out: { type: "string" }, pool: {type:"string"}, seed: { type: "string" }, count: { type: "string", default: "8" }, width: { type: "string" }, height: { type: "string" }, "first-heading": {type:"boolean"}, "dom-fingerprint":{type:"boolean"} } });
  if (!values.out || !values.width || !values.height) throw new Error("Usage: real-pages.ts --out <directory> --width <Safari width> --height <Safari height> [--seed value] [--count 8]");
  const viewport = { width: Number(values.width), height: Number(values.height) };
  if (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) || viewport.width < 1 || viewport.height < 1) throw new Error("Invalid viewport");
  const pool=values.pool?JSON.parse(await readFile(values.pool,"utf8")):publicPagePool;
  const seed = values.seed ?? randomBytes(16).toString("hex"), chosen = samplePublicPages(seed, Number(values.count),pool), generatedAt = new Date().toISOString();
  if (values["first-heading"] && values["dom-fingerprint"]) throw new Error("Heading anchors and DOM marker fingerprints are separate protocols");
  const set: CaseSet = { id: `public-pages-${seed}${values["first-heading"] ? "-first-heading" : values["dom-fingerprint"] ? "-visible-dom-v1" : ""}`, generatedAt,
    cases: chosen.map((p, i) => ({ id: `public.${i + 1}.${p.family}`, page: "", url: p.url, viewport,
      chords: [...Array.from({ length: 24 }, () => "VO+Right"), "VO+Cmd+H", "VO+Cmd+H", "VO+Left", "Tab", "Tab", "Shift+Tab"],
      ...(values["first-heading"] ? {startProtocol:"first-heading" as const} : {}),
      ...(values["dom-fingerprint"] ? {contentProtocol:"visible-dom-v1" as const} : {}),
      captureAxAfterSteps: !values["first-heading"], axes: { family: p.family, role: "real-page", command: "read-only-navigation", partition: "validation", source: "live-public-page" } })) };
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "cases.json"), JSON.stringify(set, null, 2), { flag: "wx" });
  await writeFile(join(out, "sampling.json"), JSON.stringify({ seed, generatedAt, pool, selected: chosen, contentProtocol: values["dom-fingerprint"] ? "visible-dom-v1" : values["first-heading"] ? "accessibility-text" : "rendered-text-v1", protocol: values["first-heading"] ? "First unique native AX heading anchors both browsers without modifying the page or enabling Safari JavaScript automation. Samples body reading after that heading, not the earlier header. AX-text fingerprints are conservative; engine/content differences remain failures. No replacement of failed samples." : "Fixed candidates, seeded hash ranking before collection. No replacement of failed pages; navigation only. Adds two fixture markers. Pages remain live; hashes and viewports must match before scoring speech as a match." }, null, 2), { flag: "wx" });
  console.log(`${chosen.length} seeded public pages -> ${out}`);
}
