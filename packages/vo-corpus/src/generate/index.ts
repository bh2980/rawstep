/**
 * Writes elements-v1, screening-v1 or workflows-v1: pages/<variant>.html and cases.json.
 *   tsx src/generate/index.ts --out data/cases/elements-v1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CaseSet } from "../cases.js";
import { generateElements } from "./elements.js";
import { generateScreening } from "./screening.js";
import { generateWorkflows } from "./workflows.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { set: { type: "string", default: "elements-v1" }, out: { type: "string" } } });
const generators = { "elements-v1": generateElements, "screening-v1": generateScreening, "workflows-v1": generateWorkflows };
const generator = Object.hasOwn(generators, values.set!) ? generators[values.set as keyof typeof generators] : undefined;
if (!generator) throw new Error("--set must be elements-v1, screening-v1 or workflows-v1");
const out = resolve(packageRoot, values.out ?? `data/cases/${values.set}`);

const { pages, cases } = generator();
await mkdir(join(out, "pages"), { recursive: true });
for (const [id, html] of Object.entries(pages)) await writeFile(join(out, "pages", `${id}.html`), html);
const set: CaseSet = { id: values.set!, generatedAt: new Date().toISOString(), cases };
await writeFile(join(out, "cases.json"), JSON.stringify(set, null, 2));

const byCommand: Record<string, number> = {};
for (const c of cases) byCommand[c.axes.command!] = (byCommand[c.axes.command!] ?? 0) + 1;
console.log(`${Object.keys(pages).length} pages, ${cases.length} cases ${JSON.stringify(byCommand)} -> ${out}`);
