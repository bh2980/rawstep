import { randomUUID } from 'node:crypto';
import { evaluateProfileArguments } from './page-script.js';
import type { Page } from 'playwright';
import type { BrowserDiagnostic } from '@rawstep/core/profiles/types';
/** DOM checks run on a separate evidence channel; never used for choosing keyboard actions. */
export async function collectBrowserDiagnostics(page: Page): Promise<BrowserDiagnostic> {
  return evaluateProfileArguments(page, (documentId: string) => {
    const findings: BrowserDiagnostic['findings'] = [];
    const host = window as unknown as { __rawstepDiagnosticNodes?: {ids:WeakMap<Element,number>;next:number;documentId:string} };
    const ids=host.__rawstepDiagnosticNodes ??= {ids:new WeakMap(),next:1,documentId};
    const stableId=(element:Element)=>{let id=ids.ids.get(element);if(!id){id=ids.next++;ids.ids.set(element,id)}return id;};
    const identify = (element: Element) => element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}@${stableId(element)}`; 
    const visible = (element: Element) => { const r = element.getBoundingClientRect(); const c = getComputedStyle(element); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && Number(c.opacity) > 0; };
    let active = document.activeElement; while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const el = active instanceof HTMLElement && active !== document.body && active !== document.documentElement ? active : null;
    const rect = el?.getBoundingClientRect(); const style = el ? getComputedStyle(el) : null;
    const inViewport = !!rect && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    const x = rect ? Math.min(innerWidth - 1, Math.max(0, rect.x + rect.width / 2)) : 0;
    const y = rect ? Math.min(innerHeight - 1, Math.max(0, rect.y + rect.height / 2)) : 0;
    const top = document.elementFromPoint(x, y);
    const centerOccluded = !!el && inViewport && !!top && top !== el && !el.contains(top) && !top.contains(el);
    const outline = style ? `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}` : undefined;
    const hasOutline = !!style && parseFloat(style.outlineWidth) > 0 && !['none','hidden'].includes(style.outlineStyle) && style.outlineColor !== 'rgba(0, 0, 0, 0)';
    const indicator = !el ? 'unknown' : hasOutline || style!.boxShadow !== 'none' ? 'style-detected' : 'not-detected';
    if (document.documentElement.scrollWidth > innerWidth + 1) findings.push({ code: 'horizontal-overflow', certainty: 'observed-condition', detail: `Document width ${document.documentElement.scrollWidth} exceeds viewport ${innerWidth}. Horizontal overflow alone is not a WCAG failure.` });
    if (el && !visible(el)) findings.push({ code: 'focused-element-hidden', certainty: 'observed-condition', node: identify(el), detail: 'Focused element has zero size or CSS hides it at this observation.' });
    if (el && !inViewport) findings.push({ code: 'focus-outside-viewport', certainty: 'observed-condition', node: identify(el), detail: 'Focused rectangle does not intersect the viewport.' });
    if (centerOccluded) findings.push({ code: 'focus-center-occluded', certainty: 'suspected', node: identify(el!), detail: 'A different element covers the sampled center point; full focus-indicator occlusion is not established.' });
    if (el && indicator === 'not-detected') findings.push({ code: 'focus-indicator-not-detected', certainty: 'suspected', node: identify(el), detail: 'No outline or box shadow was detected. Background, border, underline, parent or pseudo-element indicators may still be valid.' });
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(visible).slice(0, 1000);
    const textNodes = candidates.filter(e => e.childElementCount === 0 && e.textContent?.trim());
    for (const node of textNodes.slice(0, 300)) {
      const c = getComputedStyle(node);
      if ((['hidden','clip'].includes(c.overflowX) && node.scrollWidth > node.clientWidth + 2) || (['hidden','clip'].includes(c.overflowY) && node.scrollHeight > node.clientHeight + 2)) findings.push({ code: 'text-clipping', certainty: 'suspected', node: identify(node), detail: 'Text container overflows a clipping boundary; inspect screenshot for actual information loss.' });
    }
    const controls = candidates.filter(e => e.matches('button,input,select,textarea,a[href],[tabindex]')).slice(0, 150);
    for (let i=0; i<controls.length; i++) for(let j=i+1;j<controls.length;j++) { const a=controls[i]!,b=controls[j]!; if(a.contains(b)||b.contains(a))continue;const r=a.getBoundingClientRect(),s=b.getBoundingClientRect(); if(Math.min(r.right,s.right)-Math.max(r.left,s.left)>3 && Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>3) findings.push({code:'control-overlap',certainty:'suspected',node:`${identify(a)} / ${identify(b)}`,detail:'Visible control rectangles overlap; intentional overlays are possible.'}); }
    const modal = Array.from(document.querySelectorAll<HTMLElement>('dialog:modal,[role="dialog"][aria-modal="true"]')).find(visible) ?? null;
    return { kind: 'independent-browser-diagnostic', policyVisible: false, documentId:ids.documentId,
      viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, scrollX, scrollY },
      focus: { identity:el?`${ids.documentId}:${stableId(el)}`:null, id: el ? identify(el) : null, tag: el?.tagName.toLowerCase() ?? null, role: el?.getAttribute('role') ?? null, visible: !!el && visible(el), inViewport, centerOccluded, indicator, ...(outline ? { outline, shadow: style!.boxShadow } : {}), ...(rect ? { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : {}) },
      modal: { open: !!modal, focusInside: !!modal && !!el && modal.contains(el), id: modal ? identify(modal) : null },
      findings: findings.slice(0, 100), errorState: { invalidCount: document.querySelectorAll('[aria-invalid="true"]').length, alertCount: document.querySelectorAll('[role="alert"]').length },
      limitations: ['Heuristic DOM diagnostics, not policy observations or accessibility certification.', 'Up to 1000 visible elements, 300 text leaves and 150 controls inspected; frames and closed shadow roots excluded.', 'Rectangle/style checks do not prove perceived contrast, focus visibility, text readability or error announcement.'] };
  }, randomUUID());
}
