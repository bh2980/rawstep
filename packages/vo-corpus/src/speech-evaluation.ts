import type {VoiceOverSpeechInput} from 'rawstep/mock-voiceover';
import type {CaseRecord} from './cases.js';
import type {AxDump} from './axdump.js';
import {checkSpeechInput} from './speech-input.js';
import {normalize,splitSpeech} from './compare.js';
import {speechAttribution} from './session.js';

type Step=CaseRecord['steps'][number];
export function evaluateSpeechCandidate(input:VoiceOverSpeechInput,prediction:{speech:string;usageHint?:string},native:Step|undefined,dump:AxDump|undefined,options:{chord:string;startAligned:boolean;previousContextVerified:boolean}){
  const inputVerification=checkSpeechInput(input,dump),attribution=native?speechAttribution(native):undefined;
  const issues=[...(!native?['native-action-missing']:[]),...(!options.startAligned?['start-not-aligned']:[]),...(native&&native.chord!==options.chord?['command-differs']:[]),...(inputVerification.status!=='verified'?[`input-${inputVerification.status}`]:[]),...(!options.previousContextVerified?['previous-context-unverified']:[]),...(attribution?.status!=='bounded-window'?['speech-attribution-unverified']:[]),...(native?.axError?['ax-error']:[]),...(native?.foregroundError?['foreground-error']:[])];
  const nativeSpeech=native?.utterances??[],actual=splitSpeech(nativeSpeech,{observedHelp:inputVerification.status==='verified'?inputVerification.observedHelp:undefined}),candidate=[prediction.speech,...(prediction.usageHint?[prediction.usageHint]:[])];
  const eligible=issues.length===0;
  return {nativeObserved:!!native,inputVerification,attribution,eligible,issues,
    mainSpeechExact:eligible?normalize(actual.main)===normalize(prediction.speech):null,
    fullSpeechExact:eligible?JSON.stringify(nativeSpeech.map(u=>u.text))===JSON.stringify(candidate):null,
    hintCandidateExact:eligible?normalize(actual.hint)===normalize(prediction.usageHint??''):null,
    diagnosticMainMatch:!!native&&normalize(actual.main)===normalize(prediction.speech),
    nativeMain:actual.main,nativeHint:actual.hint,predictedMain:prediction.speech,predictedHint:prediction.usageHint??''};
}
export function summarizeSpeechCandidates(rows:ReturnType<typeof evaluateSpeechCandidate>[]){
  const planned=rows.length,eligible=rows.filter(r=>r.eligible).length;
  const metric=(key:'mainSpeechExact'|'fullSpeechExact'|'hintCandidateExact')=>{const matched=rows.filter(r=>r[key]===true).length;return {matched,eligible,conditionalRate:eligible?matched/eligible:null,allPlannedRate:planned?matched/planned:null};};
  const issues:Record<string,number>={};for(const row of rows)for(const issue of row.issues)issues[issue]=(issues[issue]??0)+1;
  return {planned,nativeObserved:rows.filter(r=>r.nativeObserved).length,inputVerified:rows.filter(r=>r.inputVerification.status==='verified').length,inputMismatch:rows.filter(r=>r.inputVerification.status==='mismatch').length,inputUnmeasured:rows.filter(r=>r.inputVerification.status==='unmeasured').length,eligible,issues,
    mainSpeechExact:metric('mainSpeechExact'),fullSpeechExact:metric('fullSpeechExact'),hintCandidateExact:metric('hintCandidateExact'),
    scope:'Speech formatter on caller-owned fixed targets. Full Speech compares a main/hint candidate sequence, not a native queue scheduler. No Navigation, State Accuracy or Task Success evaluation. Bounded host receipt attribution does not prove native completion.'};
}
