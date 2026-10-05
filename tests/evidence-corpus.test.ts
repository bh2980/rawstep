import { describe,it,expect } from 'vitest';
import {formatCorpusSpeech,listCorpusRules,summarizeCorpusEvaluation,type CorpusProfile} from '@rawstep/screenreaders/evidence';
import type {SimulatedSemanticNode} from '@rawstep/screenreaders/mock-voiceover/semantics';
const node:SimulatedSemanticNode={role:'button',name:'Apply',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false};
const profile:CorpusProfile={at:'nvda',browser:'chrome',atVersion:'2025.3.1',browserVersion:'143',osVersion:'Windows 11 version 21H2'};
const input={profile,node,command:'next_item',sourceFixturePath:'data/tests/html/html/buttons.html',assumedSetupMode:'auto' as const,isolatedControlContext:true};
describe('learned corpus deployment and honest evaluation',()=>{
 it('runs trained wording, keeping action and exact versions distinct',()=>{
  expect(formatCorpusSpeech(input)).toMatchObject({status:'supported',speech:'button Apply',evidenceProvenance:'simulation',nativeParityEstablished:false});
  expect(formatCorpusSpeech({...input,command:'next_focusable_item'}).speech).toBe('Apply button');
  expect(formatCorpusSpeech({...input,profile:{...profile,browserVersion:'144'}}).status).toBe('unsupported');
 });
 it('abstains by default on unseen fixture families; exploratory use must be explicit',()=>{
  expect(formatCorpusSpeech({...input,sourceFixturePath:'new-page.html'})).toMatchObject({status:'unsupported',speech:null});
  expect(formatCorpusSpeech({...input,sourceFixturePath:'new-page.html',allowExploratoryGeneralization:true})).toMatchObject({status:'supported',scope:'exploratory-generalization'});
 });
 it.each([
  ['pressed',{...node,pressed:false}],['disabled',{...node,disabled:true}],['protected',{...node,protected:true,value:'secret'}],['description',{...node,description:'context'}],['unknown-flag',{...node,invalid:true}],['missing-booleans',{role:'button',name:'Apply'}],
 ])('does not fabricate wording for %s',(_name,n)=>{
  expect(formatCorpusSpeech({...input,node:n as SimulatedSemanticNode})).toMatchObject({status:'unsupported',speech:null});
 });
 it('does not recursively substitute slots embedded in a control name',()=>{
  expect(formatCorpusSpeech({...input,node:{...node,name:'{value}'}}).speech).toBe('button {value}');
 });
 it('retains the original unfavorable holdout and separate exploratory denominators',()=>{
  const summary=summarizeCorpusEvaluation();
  expect(summary.originalStrictFixedSplit).toMatchObject({records:230,predicted:0,unsupported:230,exactAmongPredicted:null});
  expect(summary.evaluationStatus).toBe('exploratory-validation-after-initial-holdout-inspection');
  expect(summary.fixedHoldout).toMatchObject({records:509,predicted:4,exactMatches:4,unsupported:505});
  expect(summary.leaveOneUnseenFamilyOut).toMatchObject({records:2606,predicted:18,exactMatches:8,mismatches:10,unsupported:2588});
  expect(listCorpusRules()).toHaveLength(8);
  expect(listCorpusRules().every(r=>r.trainingFamilies.length>=2)).toBe(true);
 });
});
