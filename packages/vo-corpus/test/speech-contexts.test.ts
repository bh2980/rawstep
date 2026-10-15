import assert from 'node:assert/strict';
import test from 'node:test';
import {generateSpeechContexts} from '../src/generate/speech-contexts.js';

test('speech contexts preserve paired inputs, native commands and caller-owned target state',()=>{
  const set=generateSpeechContexts();
  assert.equal(set.cases.length,6);
  assert.equal(set.cases.reduce((n,c)=>n+c.chords.length,0),60);
  assert.equal(new Set(set.cases.map(c=>c.axes.contrastGroup)).size,3);
  for(const c of set.cases){
    const inputs=set.speechInputs[c.id]!;
    assert.equal(inputs.length,c.chords.length);
    assert.equal(c.axes.partition,'test');
    assert.match(set.pages[c.page.slice(6,-5)]!,/id="before"/);
    for(const [i,input]of inputs.entries()){
      assert.ok(['button','checkbox'].includes(input.target.semantic.role));
      assert.equal(input.command,c.chords[i]==='Tab'?'next_focusable_item':'previous_focusable_item');
      assert.ok(!('speech' in input));
      assert.ok(!('utterances' in input));
    }
  }
  const flat=set.speechInputs['speech-contexts-v1.sibling-regions-flat']![0]!,group=set.speechInputs['speech-contexts-v1.sibling-regions-group']![0]!;
  assert.deepEqual(flat.target.semantic,group.target.semantic);
  assert.equal(group.target.containers!.length,flat.target.containers!.length+1);
});
