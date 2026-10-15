import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateSpeechCandidate,summarizeSpeechCandidates} from '../src/speech-evaluation.js';
import {generateSpeechContexts} from '../src/generate/speech-contexts.js';

test('identical text without independently verified inputs never counts as an accurate prediction',()=>{
  const input=generateSpeechContexts().speechInputs['speech-contexts-v1.sibling-regions-flat']![0]!;
  const step={chord:'Tab',utterances:[{t:20,text:'same speech'}],reason:'quiet' as const,timing:{requestedAt:10,acknowledgedAt:11,observationStartedAt:12,observationEndedAt:30,requestClock:'wire-request-v1' as const}};
  const row=evaluateSpeechCandidate(input,{speech:'same speech'},step,undefined,{chord:'Tab',startAligned:true,previousContextVerified:true});
  assert.equal(row.diagnosticMainMatch,true);assert.equal(row.eligible,false);assert.equal(row.mainSpeechExact,null);
  const missing=evaluateSpeechCandidate(input,{speech:'same speech'},undefined,undefined,{chord:'Tab',startAligned:false,previousContextVerified:false});
  const summary=summarizeSpeechCandidates([row,missing]);
  assert.equal(summary.planned,2);assert.equal(summary.nativeObserved,1);assert.equal(summary.eligible,0);assert.equal(summary.mainSpeechExact.conditionalRate,null);assert.equal(summary.mainSpeechExact.allPlannedRate,0);
  assert.equal(summary.issues['native-action-missing'],1);
});

test('eligible main speech, literal full speech and uncertain attribution retain different denominators',()=>{
  const input={command:'next_focusable_item',target:{identity:'save',semantic:{role:'button',name:'Save',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false},containers:[]}};
  const sample={protocol:'visible-vo-overlay-v1',status:'observed',frame:{x:16,y:26,width:108,height:38},window:{id:11,ownerPID:99,layer:2997,x:0,y:0,width:1024,height:768}};
  const dump={app:'Safari',pid:1,windowTitle:'',timestamp:'',nodeCount:2,truncated:false,focusedPath:null,root:{AXRole:'AXWebArea',children:[{AXRole:'AXButton',AXTitle:'Save',AXDOMIdentifier:'save',AXElementId:2,AXEnabled:true,AXPosition:{x:20,y:30},AXSize:{width:100,height:30}}]},visualCursor:{before:sample,after:sample,stable:true}};
  const prediction={speech:'Save, button',usageHint:'You are currently on a button.'};
  const native={chord:'Tab',utterances:[{t:20,text:'Save button'},{t:25,text:prediction.usageHint}],reason:'quiet' as const,timing:{requestedAt:10,acknowledgedAt:11,observationStartedAt:12,observationEndedAt:30,requestClock:'wire-request-v1' as const}};
  const options={chord:'Tab',startAligned:true,previousContextVerified:true};
  const valid=evaluateSpeechCandidate(input,prediction,native,dump,options);
  assert.equal(valid.eligible,true);assert.equal(valid.mainSpeechExact,true);assert.equal(valid.fullSpeechExact,false);assert.equal(valid.hintCandidateExact,true);
  const late=evaluateSpeechCandidate(input,prediction,{...native,utterances:[{t:31,text:'Save button'}]},dump,options);
  assert.equal(late.eligible,false);assert.equal(late.attribution?.status,'uncertain');
  const summary=summarizeSpeechCandidates([valid,late]);
  assert.equal(summary.mainSpeechExact.matched,1);assert.equal(summary.mainSpeechExact.conditionalRate,1);assert.equal(summary.mainSpeechExact.allPlannedRate,.5);
  assert.equal(summary.fullSpeechExact.matched,0);
});
