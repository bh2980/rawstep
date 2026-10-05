#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';import {dirname,resolve} from 'node:path';
import {readTrace} from '@rawstep/core/trace';import {resolveTask} from '@rawstep/core/contracts';import {exportScreenshotReplay} from 'rawstep/screenshot';
const [source,taskFile,out]=process.argv.slice(2);if(!source||!taskFile||!out)throw Error('Usage: node scripts/visual-study/export-replay.mjs TRACE TASK_JSON OUTPUT_JSON');
const task=resolveTask(JSON.parse(await readFile(taskFile,'utf8')),dirname(resolve(taskFile)));const replay=exportScreenshotReplay(await readTrace(source),task);await writeFile(out,JSON.stringify(replay,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({out,steps:replay.steps.length,sourceRunId:replay.sourceRunId}));
