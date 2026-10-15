/**
 * Writes elements-v1, screening-v1 or workflows-v1: pages/<variant>.html and cases.json.
 *   tsx src/generate/index.ts --out data/cases/elements-v1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CaseSet } from "../cases.js";
import { generateElements } from "./elements.js";
import { generateScreening } from "./screening.js";
import { generateWorkflows } from "./workflows.js";
import { generateExpanded } from "./expanded.js";
import { generateFollowup } from "./followup.js";
import { generatePagePatterns } from "./page-patterns.js";
import { generateListHeuristics } from "./list-heuristics.js";
import { generateArticlePatterns } from "./article-patterns.js";
import { generateDiversity } from "./diversity.js";
import { generateArticleFollowup } from "./article-followup.js";
import { generateHints } from "./hints.js";
import { generateReadingUnits,generateReadingReturns,generateReadingState,generateFocusContext,generateListboxInteraction } from "./reading-units.js";
import {generatePracticalTasks} from './practical-tasks.js';
import {generateContextReturn} from './context-return.js';
import {generateSpeechContexts} from './speech-contexts.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { set: { type: "string", default: "elements-v1" }, out: { type: "string" } } });
const generators = { "elements-v1": generateElements, "screening-v1": generateScreening, "workflows-v1": generateWorkflows,
  "training-v2": () => generateExpanded("training"), "validation-v2": () => generateExpanded("validation"), "focus-followup-v3": generateFollowup, "page-patterns-v1": generatePagePatterns, "list-heuristics-v1":generateListHeuristics, "article-patterns-v1":generateArticlePatterns, "diversity-v1":generateDiversity,
  "article-followup-v2":()=>generateArticleFollowup('train'),"article-transfer-v2":()=>generateArticleFollowup('test'),
  "hints-v1":()=>generateHints('train'),"hints-transfer-v1":()=>generateHints('test'),
  "reading-units-v1":()=>generateReadingUnits('train'),"reading-units-transfer-v1":()=>generateReadingUnits('test'),"reading-returns-v1":generateReadingReturns,"reading-state-v1":generateReadingState,"focus-context-v1":generateFocusContext,"listbox-interaction-v1":generateListboxInteraction,"practical-tasks-v1":generatePracticalTasks,"context-return-v1":generateContextReturn,"speech-contexts-v1":generateSpeechContexts };
const generator = Object.hasOwn(generators, values.set!) ? generators[values.set as keyof typeof generators] : undefined;
if (!generator) throw new Error(`--set must be ${Object.keys(generators).join(", ")}`);
const out = resolve(packageRoot, values.out ?? `data/cases/${values.set}`);
if(existsSync(join(out,'cases.json')))throw new Error('Case set already exists; choose a new --out directory/version instead of replacing fixture inputs');

const { pages, cases } = generator();
await mkdir(join(out, "pages"), { recursive: true });
for (const [id, html] of Object.entries(pages)) await writeFile(join(out, "pages", `${id}.html`), html,{flag:'wx'});
const set: CaseSet = { id: values.set!, generatedAt: new Date().toISOString(), syntheticInputs: true, cases };
await writeFile(join(out, "cases.json"), JSON.stringify(set, null, 2),{flag:'wx'});

const byCommand: Record<string, number> = {};
for (const c of cases) byCommand[c.axes.command!] = (byCommand[c.axes.command!] ?? 0) + 1;
console.log(`${Object.keys(pages).length} pages, ${cases.length} cases ${JSON.stringify(byCommand)} -> ${out}`);
