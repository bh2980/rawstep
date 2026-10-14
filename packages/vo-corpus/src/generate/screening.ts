/** A small, varied subset of elements-v1 to check capture before the full matrix. */
import { generateElements } from "./elements.js";

const ids = [
  "button-plain.next",
  "button-plain.tab",
  "button-pressed-true.next",
  "checkbox-unchecked.activate",
  "checkbox-checked.next",
  "radio-fieldset.next",
  "input-text-label-for.tab",
  "input-text-required.next",
  "input-text-describedby.next",
  "select-single.tab",
  "range-slider.tab",
  "heading-h2.next",
  "img-alt.next",
  "list-ul.next",
  "table-simple.next",
  "landmark-nav.next",
  "details-closed.activate",
  "dialog-role.next",
  "text-korean-mixed.next",
  "checkbox-unchecked.tab",
];

export function generateScreening() {
  const all = generateElements();
  const byId = new Map(all.cases.map(item => [item.id, item]));
  const cases = ids.map(id => {
    const item = byId.get(id);
    if (!item) throw new Error(`Missing screening case ${id}`);
    return item;
  });
  const pages = Object.fromEntries([...new Set(cases.map(item => item.page))].map(page => {
    const id = page.slice("pages/".length, -".html".length);
    return [id, all.pages[id]!];
  }));
  return { pages, cases };
}
