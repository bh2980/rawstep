#!/usr/bin/env node
import {readFile} from 'node:fs/promises';import {dirname,resolve} from 'node:path';import {resolveTask} from '@rawstep/core/contracts';import {runScreenshotReplay} from 'rawstep/screenshot';
const [taskFile,manifest,outDir]=process.argv.slice(2);if(!taskFile||!manifest||!outDir)throw Error('Usage: node scripts/visual-study/replay.mjs TASK_JSON SCENARIO_JSON FRESH_OUTPUT_DIR');
const task=resolveTask(JSON.parse(await readFile(taskFile,'utf8')),dirname(resolve(taskFile)));const replay=JSON.parse(await readFile(manifest,'utf8'));const controller=new AbortController();for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>controller.abort(s));
const trace=await runScreenshotReplay(task,replay,{outDir,signal:controller.signal,...(process.env.RAWSTEP_TEST_BROWSER_PATH?{browserExecutablePath:process.env.RAWSTEP_TEST_BROWSER_PATH}:{})});console.log(JSON.stringify(trace.outcome));if(trace.outcome?.status!=='success')process.exitCode=1;
