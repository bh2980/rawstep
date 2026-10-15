import assert from 'node:assert/strict';import test from 'node:test';import {nativeCustomContent} from '../src/native-content.js';
test('only explicit API observations establish presence or absence of more content',()=>{
 assert.equal(nativeCustomContent({}).status,'unmeasured');
 assert.equal(nativeCustomContent({AXCustomContent:{status:'unsupported'}}).status,'unmeasured');
 assert.equal(nativeCustomContent({AXCustomContent:{status:'decode-error'}}).status,'unmeasured');
 assert.deepEqual(nativeCustomContent({AXCustomContent:{status:'no-value',errorCode:-25212}}),{status:'observed',hasMoreContent:false,entries:[]});
 const value={status:'observed',byteCount:1,rawBase64:Buffer.from('x').toString('base64'),entries:[{label:'description',value:'Note',importance:1}]};
 assert.equal(nativeCustomContent({AXCustomContent:value}).hasMoreContent,true);
 assert.equal(nativeCustomContent({AXCustomContent:{...value,rawBase64:'invalid'}}).status,'unmeasured');
 assert.equal(nativeCustomContent({AXCustomContent:{...value,entries:[null]}}).status,'unmeasured');
 assert.equal(nativeCustomContent({AXCustomContent:value,AXCustomContentWithheld:true}).status,'unmeasured');
});
