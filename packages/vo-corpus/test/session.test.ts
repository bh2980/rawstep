import assert from 'node:assert/strict';
import test from 'node:test';
import {chordKeys,speechAttribution,VoSession} from '../src/session.js';

test('native orientation and VoiceOver lifecycle probes use WebDriver function-key codes',()=>{
  assert.deepEqual(chordKeys('VO+F3'),['\uE009','\uE00A','\uE033']);
  assert.deepEqual(chordKeys('VO+Shift+F4'),['\uE009','\uE00A','\uE008','\uE034']);
  assert.deepEqual(chordKeys('Cmd+F5'),['\uE03D','\uE035']);
});


test('delayed and pre-request speech stay uncertain even if a quiet gap was reached',()=>{
  const timing={requestedAt:100,observationEndedAt:200,requestClock:'wire-request-v1' as const};
  const step={reason:'quiet',timing,utterances:[{t:90,text:'Previous delayed hint'},{t:150,text:'Current target'},{t:250,text:'Late hint'}]};
  const original=JSON.stringify(step),result=speechAttribution(step);
  assert.deepEqual(result,{status:'uncertain',beforeRequest:1,afterWindow:1,completionVerified:false});
  assert.equal(JSON.stringify(step),original);
  assert.equal(speechAttribution({...step,utterances:[{t:150,text:'Current'}]}).status,'bounded-window');
  assert.equal(speechAttribution({...step,reason:'deadline',utterances:[]}).status,'uncertain');
  assert.equal(speechAttribution({reason:'quiet',utterances:[]}).status,'unmeasured');
});


test('request timing excludes foreground guard work and detects speech buffered before sending',async()=>{
  const original=globalThis.WebSocket;
  let socket:FakeSocket,guardEnded=0;
  class FakeSocket {
    readyState=1;
    listeners=new Map<string,Set<(event:unknown)=>void>>();
    constructor(){socket=this;}
    addEventListener(type:string,listener:(event:unknown)=>void){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type)!.add(listener);}
    removeEventListener(type:string,listener:(event:unknown)=>void){this.listeners.get(type)?.delete(listener);}
    emit(type:string,event:unknown){for(const listener of this.listeners.get(type)??[])listener(event);}
    send(data:string){const command=JSON.parse(data);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:command.id,result:command.method==='session.new'?{sessionId:'test',capabilities:{atName:'VoiceOver'}}:{}})}));}
    close(){this.readyState=3;this.emit('close',{code:1000});}
    output(text:string){this.emit('message',{data:JSON.stringify({method:'interaction.capturedOutput',params:{data:text}})});}
  }
  globalThis.WebSocket=FakeSocket as unknown as typeof WebSocket;
  const session=new VoSession('ws://test/session',async()=>{
    socket!.output('Previous delayed hint');
    await new Promise(done=>setTimeout(done,25));
    guardEnded=session.now();
  });
  try{
    await session.start();
    const timing=await session.press('VO+Right');
    assert.ok(timing.requestedAt>=guardEnded);
    assert.ok(timing.acknowledgedAt>=timing.requestedAt);
    const heard=await session.listen({quietMs:0,maxWaitMs:100});
    assert.deepEqual(heard.utterances.map(u=>u.text),['Previous delayed hint']);
    assert.equal(speechAttribution({reason:heard.reason,utterances:heard.utterances,timing:{...timing,observationEndedAt:heard.endedAt,requestClock:'wire-request-v1'}}).beforeRequest,1);
  }finally{await session.close();globalThis.WebSocket=original;}
});
