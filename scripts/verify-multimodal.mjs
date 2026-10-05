/** Opt-in, real external model smoke; no model downloads or automatic fallback. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runCli } from '@rawstep/cli/cli';
import { readTrace, writeJsonAtomic } from '@rawstep/core/trace';
const [task, destination, ...flags] = process.argv.slice(2);
assert.ok(task && destination, 'Usage: node scripts/verify-multimodal.mjs TASK_JSON NEW_OUT_DIR [--decision-* overrides]');
const out=resolve(destination);
const browserFlags=process.env.RAWSTEP_TEST_BROWSER_PATH?['--browser-executable',process.env.RAWSTEP_TEST_BROWSER_PATH]:[];
const code=await runCli(['screenshot-run',resolve(task),'--decision','systemone','--out',out,...browserFlags,...flags]);
const trace=await readTrace(out);
const inferences=trace.events.filter(e=>e.type==='policy.evidence' && e.data?.evidence?.kind==='model-inference');
const models=inferences.map(e=>e.data.evidence.model);
const passed=code===0 && models.length>0 && models.every(m=>['systemone-http','openrouter-systemone-http'].includes(m.runtime));
await writeJsonAtomic(resolve(out,'multimodal-evidence.json'),{status:passed?'passed':'incomplete',runId:trace.runId,outcome:trace.outcome,models,
  limitations:['Actual configured external model smoke, not measured model accuracy or accessibility certification.']});
assert.ok(passed,'Real multimodal smoke did not pass; inspect the saved trace.');
