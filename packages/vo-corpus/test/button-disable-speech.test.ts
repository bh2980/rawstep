import assert from 'node:assert/strict';import test from 'node:test';
import {generateButtonDisableSpeech} from '../src/generate/button-disable-speech.js';import {actionSequenceGroup} from '../src/dataset-split.js';
test('self-disable controls isolate state/context and reserve complete reverse-entry histories',()=>{
 const train=generateButtonDisableSpeech('train'),held=generateButtonDisableSpeech('test');assert.equal(train.cases.length,4);assert.equal(held.cases.length,2);
 for(const c of train.cases)assert.deepEqual(c.chords,['Tab','Space']);
 for(const c of held.cases){assert.equal(c.axes.exposure,'unseen');assert.equal(c.axes.oraclePurpose,'fixture-health');assert.ok(!train.cases.some(t=>actionSequenceGroup(t.chords)===actionSequenceGroup(c.chords)));assert.equal(c.chords.at(-1),'Space');assert.equal(c.taskOutcome!.controls[0]!.state.disabled,true);}
});
