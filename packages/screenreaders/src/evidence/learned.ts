import { LEARNED_CORPUS_RULES, CORPUS_EVALUATION } from './learned-data.js';
import type { SimulatedSemanticNode } from '../mock-voiceover/semantics.js';
export type CorpusProfile = { at: 'voiceover' | 'nvda'; browser: 'safari' | 'chrome' | 'edge' | 'firefox'; atVersion: string; browserVersion: string; osVersion: string };
export type CorpusSpeechInput = {
  profile: CorpusProfile; command: string; node: SimulatedSemanticNode;
  /** Source fixture families bound deployed rules. Novel families abstain by default. */
  sourceFixturePath?: string;
  assumedSetupMode: 'auto';
  isolatedControlContext: boolean;
  /** Explicit research opt-in; results are exploratory, not confirmed heldout accuracy. */
  allowExploratoryGeneralization?: boolean;
};
export type CorpusSpeechResult = { status:'supported'|'unsupported';speech:string|null;reason?:string;ruleId?:string;sourceIds:string[];scope:'source-bounded-training-rule'|'exploratory-generalization';evidenceProvenance:'simulation';nativeParityEstablished:false };
export class UnsupportedCorpusPatternError extends Error {
  readonly code='UNSUPPORTED_CORPUS_PATTERN';
  constructor(readonly result:CorpusSpeechResult){super(result.reason??'No supported corpus wording pattern.');this.name='UnsupportedCorpusPatternError';}
}
export function formatCorpusSpeech(input:CorpusSpeechInput):CorpusSpeechResult {
  const base={scope:input.allowExploratoryGeneralization===true?'exploratory-generalization' as const:'source-bounded-training-rule' as const,evidenceProvenance:'simulation' as const,nativeParityEstablished:false as const,sourceIds:[] as string[]};
  const unsupported=(reason:string):CorpusSpeechResult=>({...base,status:'unsupported',speech:null,reason});
  const n=input.node;
  if(!n||!input.isolatedControlContext||input.assumedSetupMode!=='auto')return unsupported('Missing isolated-control/setup premise; no corpus fallback speech is fabricated.');
  if(['protected','disabled','readonly','required','multiline','modal'].some(k=>typeof n[k as keyof SimulatedSemanticNode]!=='boolean'))return unsupported('Explicit semantic booleans are required; unknown is not false.');
  if(typeof n.name!=='string'||!n.name.trim()||n.protected||n.description||n.modal||n.level!==undefined)return unsupported('Name, description, protected or contextual state is outside learned rule coverage.');
  const flags:Record<string,string>={};
  for(const name of ['checked','pressed','expanded','selected'] as const)if(n[name]!==undefined)flags[name]=String(n[name]);
  for(const name of ['disabled','required','readonly','multiline'] as const)if(n[name])flags[name]='true';
  const allowedNodeKeys=new Set(['role','name','value','description','protected','disabled','readonly','required','multiline','modal','level','checked','pressed','expanded','selected']);
  if(Object.keys(n).some(k=>!allowedNodeKeys.has(k)))return unsupported('Unmodeled semantic fields were provided.');
  const flagKey=(v:Record<string,string>)=>JSON.stringify(Object.entries(v).sort());
  const matches=LEARNED_CORPUS_RULES.filter(r=>r.key.at===input.profile.at&&r.key.browser===input.profile.browser&&r.key.role===n.role&&r.key.command===input.command&&r.key.beforeMode===input.assumedSetupMode&&r.key.hasValue===!!n.value&&flagKey(r.key.flags)===flagKey(flags)&&r.allowedVersions.some(v=>v.atVersion===input.profile.atVersion&&v.browserVersion===input.profile.browserVersion&&v.osVersion===input.profile.osVersion));
  if(matches.length!==1)return unsupported('No unique training rule matches the exact AT/browser/OS version, command and state.');
  const r=matches[0]!;
  if(input.allowExploratoryGeneralization!==true&&(!input.sourceFixturePath||!(r.trainingFixturePaths as readonly string[]).includes(input.sourceFixturePath)))return unsupported('Novel or undeclared fixture family: heldout generalization is not established, so deployed defaults abstain.');
  const speech=r.template.replace(/\{name\}|\{value\}/g,slot=>slot==='{name}'?n.name:n.value??'');
  return {...base,status:'supported',speech,ruleId:r.id,sourceIds:[...r.trainingSourceIds]};
}
export function summarizeCorpusEvaluation(){return structuredClone(CORPUS_EVALUATION);}
export function listCorpusRules(){return structuredClone(LEARNED_CORPUS_RULES);}
