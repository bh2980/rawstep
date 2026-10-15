import assert from 'node:assert/strict';
import test from 'node:test';
import type {AxDump} from '../src/axdump.js';
import {matchesDocumentURL,waitForNativeDocument} from '../src/document-ready.js';
const snapshot=(url:string,children=true)=>({truncated:true,root:{AXRole:'AXWebArea',AXURL:url,...(children?{children:[{AXRole:'AXGroup'}]}:{})}} as AxDump);
test('requested document matching accepts canonical additions and rejects old pages, lost queries and origin changes',()=>{
 assert.equal(matchesDocumentURL('https://example.test/search/?q=history&mode=all','https://example.test/search?q=history'),true);
 for(const actual of ['https://example.test/old?q=history','https://other.test/search?q=history','https://example.test/search','https://example.test/search?q=other','https://example.test/search?q=history&q=other','about:blank'])assert.equal(matchesDocumentURL(actual,'https://example.test/search?q=history'),false);
});
test('quiet or transient missing AX cannot stand in for the requested document',async()=>{
 const requested='https://example.test/new',probes:unknown[]=[];let call=0;
 const result=await waitForNativeDocument(async()=>{
  call++;if(call===1)return snapshot('https://example.test/old');if(call===2)throw new Error('AXWebArea not present yet');if(call===3)return snapshot(requested,false);return snapshot(requested);
 },requested,{pollMs:1,timeoutMs:200,onProbe:p=>{probes.push(p);}});
 assert.equal(result.status,'document-observed');assert.equal(result.attempts,4);assert.equal(probes.length,4);
});
test('document timeout retains probe errors and does not mask journal failures',async()=>{
 const probes:unknown[]=[];
 const result=await waitForNativeDocument(async()=>{throw new Error('missing AX');},'https://example.test/',{timeoutMs:0,onProbe:p=>{probes.push(p);}});
 assert.equal(result.status,'timeout');assert.equal(probes.length,1);
 await assert.rejects(waitForNativeDocument(async()=>snapshot('https://example.test/'),'https://example.test/',{onProbe:()=>{throw new Error('journal unavailable');}}),/journal unavailable/);
});
