/**
 * Writes the elements-v1 case set: pages/<variant>.html and cases.json.
 *   tsx src/generate/index.ts --out data/cases/elements-v1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CaseSet } from "../cases.js";
import { generateElements } from "./elements.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { out: { type: "string", default: "data/cases/elements-v1" } } });
const out = resolve(packageRoot, values.out!);

const { pages, cases } = generateElements();
await mkdir(join(out, "pages"), { recursive: true });
for (const [id, html] of Object.entries(pages)) await writeFile(join(out, "pages", `${id}.html`), html);
const set: CaseSet = { id: "elements-v1", generatedAt: new Date().toISOString(), cases };
await writeFile(join(out, "cases.json"), JSON.stringify(set, null, 2));

const byCommand: Record<string, number> = {};
for (const c of cases) byCommand[c.axes.command!] = (byCommand[c.axes.command!] ?? 0) + 1;
console.log(`${Object.keys(pages).length} pages, ${cases.length} cases ${JSON.stringify(byCommand)} -> ${out}`);
