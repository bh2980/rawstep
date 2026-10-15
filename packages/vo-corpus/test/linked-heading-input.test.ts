import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {checkSpeechInput,observedSpeechInput,observedSpeechContext} from '../src/speech-input.js';
import {observeVisualCursor} from '../src/cursor.js';
import type {AxDump} from '../src/axdump.js';
const fixture=JSON.parse(readFileSync(new URL('native-linked-heading-inputs.json',import.meta.url),'utf8')) as {samples:{browser:'safari'|'chrome';caseId:string;dump:AxDump}[]};
const sample=(browser:string,suffix:string)=>structuredClone(fixture.samples.find(s=>s.browser===browser&&s.caseId.endsWith('.'+suffix))!.dump);
const target=(d:AxDump)=>{const v=observeVisualCursor(d);assert.equal(v.status,'observed');if(v.status!=='observed')throw new Error(v.status);let n=d.root;for(const index of v.candidates[0]!.paths[0]!)n=n.children![index]!;return n;};

test('Native single linked-heading projection separates physical outline from activation identity',()=>{
 for(const browser of ['safari','chrome'])for(const order of ['link-outside','heading-outside']){
  const d=sample(browser,order),before=JSON.stringify(d),observation=observedSpeechInput(d,'next_item');
  if(browser==='chrome'&&order==='heading-outside'){assert.equal(observation.status,'unmeasured');continue;}
  assert.equal(observation.status,'observed');if(observation.status!=='observed')throw new Error(observation.reason);
  const {input,verification}=observation;assert.equal(input.target.identity,'first');assert.equal(input.target.semantic.role,'heading');assert.equal(input.target.semantic.level,2);assert.equal(input.target.semantic.headingLink,true);
  assert.equal(input.target.semantic.headingLinkOrder,order==='link-outside'?'link-heading':undefined);
  assert.equal(verification.observedPhysicalTarget?.id,order==='link-outside'?'first':'heading');
  assert.equal(JSON.stringify(d),before);assert.equal(observedSpeechContext(d).status,'observed');
  const missing=structuredClone(input);delete missing.target.semantic.headingLink;assert.equal(checkSpeechInput(missing,d).status,'mismatch');
  const plain=structuredClone(input);plain.target.semantic={...plain.target.semantic,role:'link',headingLink:undefined,headingParts:undefined,headingLinkOrder:undefined,level:undefined};assert.equal(checkSpeechInput(plain,d).status,'mismatch');
  for(const command of ['next_focusable_item','next_heading','read_current'])assert.equal(checkSpeechInput({...input,command},d).status,'unmeasured');
 }
});

test('a separately measured disclosure attribute cannot be invented for old Native snapshots',()=>{
 const d=sample('chrome','heading-outside'),node=target(d);
 assert.equal(node.AXDisclosureLevel,undefined);assert.equal(observedSpeechInput(d,'next_item').status,'unmeasured');
 // Synthetic verifier test only: the original observation remains missing this attribute.
 node.AXDisclosureLevel=1;const observation=observedSpeechInput(d,'next_item');assert.equal(observation.status,'observed');
 if(observation.status!=='observed')throw new Error(observation.reason);
 assert.equal(observation.input.target.semantic.nativeDisclosureLevel,1);
 const wrong=structuredClone(observation.input);wrong.target.semantic.nativeDisclosureLevel=2;assert.equal(checkSpeechInput(wrong,d).status,'mismatch');
 delete wrong.target.semantic.nativeDisclosureLevel;assert.equal(checkSpeechInput(wrong,d).status,'mismatch');
});

test('compound input verification refuses incomplete, aliased, renamed or extra-content units',()=>{
 for(const mutate of [
  (n:any)=>{n.childrenTruncated=1;},(n:any)=>{delete n.children[0].AXElementId;},
  (n:any)=>{n.children[0].AXElementId=n.AXElementId;},(n:any)=>{n.children[0].AXTitle='Different title';},
  (n:any)=>{n.children[0].AXHelp='New help';},(n:any)=>{n.children.push({...n.children[0],AXElementId:99});},
 ]){const d=sample('safari','link-outside');mutate(target(d));assert.equal(observedSpeechInput(d,'next_item').status,'unmeasured');}
 const d=sample('safari','heading-outside'),node=target(d),observation=observedSpeechInput(d,'next_item');assert.equal(observation.status,'observed');
 if(observation.status!=='observed')throw new Error(observation.reason);
 const wrong=structuredClone(observation.input);wrong.target.identity=String(node.AXDOMIdentifier);assert.equal(checkSpeechInput(wrong,d).status,'mismatch');
});
