import { createBrowserSession } from '@rawstep/browser/browser';
import type { Task } from '@rawstep/core/contracts';
import { MockVoiceOverBackend } from '../mock-voiceover/backend.js';
import { runTask, type RunOptions } from '@rawstep/browser/runner';
import { formatCorpusSpeech, type CorpusProfile } from './learned.js';
import { UnsupportedCorpusPatternError } from './unsupported.js';
export type CorpusMockOptions = { profile:CorpusProfile; sourceFixturePath:string };
/** Explicit source-bounded word simulation over Chromium flat navigation, never native NVDA/VO. */
export function createCorpusMockBackend(input:CorpusMockOptions):MockVoiceOverBackend {
  const options=structuredClone(input);
  return new MockVoiceOverBackend({profile:`corpus-source-bounded-${options.profile.at}`,metadata:{referenceEnvironment:options.profile,sourceFixturePath:options.sourceFixturePath,nativeMeasurement:false,scope:'source-bounded learned wording over Chromium flat navigation'},capabilities:{intents:['next'],keys:['Tab'],textEntry:false,replaceText:false},format:(node,context)=>{
    if(!node)throw new UnsupportedCorpusPatternError({status:'unsupported',speech:null,reason:'No source-bounded boundary or empty-content wording is modeled.',sourceIds:[],scope:'source-bounded-training-rule',evidenceProvenance:'simulation',nativeParityEstablished:false});
    const result=formatCorpusSpeech({profile:options.profile,sourceFixturePath:options.sourceFixturePath,command:context.sourceCommand,node,assumedSetupMode:'auto',isolatedControlContext:!context.unmodeledContext});
    if(result.status==='unsupported')throw new UnsupportedCorpusPatternError(result);
    return {speech:result.speech!,evidence:{...result,referenceProfile:options.profile,sourceCommand:context.sourceCommand,initialObservationConvention:'first isolated object uses next_item wording; no native command was sent'}};
  }});
}
export function runCorpusMockTask(task:Task,options:Omit<RunOptions,'backend'> & { corpus:CorpusMockOptions }){
  const backend=createCorpusMockBackend(options.corpus);const factory=options.browserSessionFactory??createBrowserSession;
  return runTask(task,{...options,backend,headless:options.headless??true,browserSessionFactory:async(url,config)=>{const session=await factory(url,config);backend.attachSession(session);return session;}});
}
