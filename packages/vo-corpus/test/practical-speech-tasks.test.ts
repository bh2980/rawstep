import assert from 'node:assert/strict';import test from 'node:test';
import {generatePracticalSpeechTasks} from '../src/generate/practical-speech-tasks.js';
import {generatePracticalTasks} from '../src/generate/practical-tasks.js';
import {actionSequenceGroup} from '../src/dataset-split.js';
import {chordKeys} from '../src/session.js';import {replayAction} from '../src/replay.js';
test('fresh task cohort preserves full editing, restore and focus-disable histories and independent outcomes',()=>{
 const generated=generatePracticalSpeechTasks();assert.equal(generated.cases.length,3);
 assert.equal(generated.cases.reduce((n,c)=>n+c.chords.length,0),48);
 const existing=generatePracticalTasks();
 for(const c of generated.cases){assert.equal(c.axes.exposure,'unseen');assert.equal(c.axes.oraclePurpose,'task-outcome');assert.ok(c.taskOutcome!.texts.length);assert.ok(c.taskOutcome!.controls.length);assert.ok(!existing.cases.some(p=>actionSequenceGroup(p.chords)===actionSequenceGroup(c.chords)));
  for(const chord of c.chords){assert.ok(chordKeys(chord).length);assert.ok(replayAction(chord,'fixture'));}
 }
 assert.deepEqual(generated.cases[0]!.chords.slice(0,6),['Tab','m','a','p','Tab','Enter']);
 assert.ok(generated.pages['publication-settings']!.includes("byId('apply').disabled=true"));
 assert.ok(generated.pages['supply-basket']!.includes('role=status'));
 assert.ok(generated.pages['supply-basket']!.includes("byId('remove').disabled=Number(byId('quantity').value)<=1"));
});
