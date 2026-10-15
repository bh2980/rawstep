import assert from 'node:assert/strict';
import test from 'node:test';
import {splitSpeech} from '../src/compare.js';
test('help-prefixed hints require independently observed help and preserve unrelated later speech',()=>{
 const utterances=[{text:'Print copies. button'},{text:'Copies, not originals.  You are currently on a button. '},{text:'Saved successfully'}];
 assert.equal(splitSpeech(utterances).main,'Print copies. button Copies, not originals.  You are currently on a button. Saved successfully');
 assert.deepEqual(splitSpeech(utterances,{observedHelp:'Copies, not originals.'}),{main:'Print copies. button Saved successfully',hint:'Copies, not originals.  You are currently on a button.'});
 assert.deepEqual(splitSpeech([{text:'Copies, not originals. button'}],{observedHelp:'Copies, not originals.'}),{main:'Copies, not originals. button',hint:''});
 assert.equal(splitSpeech(utterances,{observedHelp:'Copies'}).hint,'');
});
