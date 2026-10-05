#!/usr/bin/env python3
"""Generate the compact runtime catalog from separately retained normalized evidence."""
import argparse,json,pathlib,collections,hashlib
p=argparse.ArgumentParser();p.add_argument('--evidence-root',type=pathlib.Path,required=True);p.add_argument('--repo',type=pathlib.Path,required=True);a=p.parse_args();e=a.evidence_root
PIN='6730ad42e83dd780f63555ab3f14f1c26ea0fae5'
def load(rel):return json.loads((e/rel).read_text())
nv=load('nvda/nvda-observations.json');vo=load('a11ysupport/normalized-v2/vo_macos-observations.json');lookup={r['id']:r for r in nv+vo};cases=[]
base={'protected':False,'disabled':False,'readonly':False,'required':False,'multiline':False,'modal':False}
def pattern(n):
 if n['role']=='button' and 'pressed' in n:return 'toggle-button.'+('mixed' if n['pressed']=='mixed' else str(n['pressed']).lower())
 if n['role']=='button' and 'expanded' in n:return 'disclosure.'+('expanded' if n['expanded'] else 'collapsed')
 if n['role']=='checkbox':return 'checkbox.'+('checked' if n.get('checked') else 'unchecked')
 if n['role']=='textbox':return 'textarea.valued' if n.get('multiline') else 'textbox.'+('required' if n.get('required') else 'optional')
 return n['role']
def add(id,node,kind):
 r=lookup[id];env=r['environment'];at='nvda' if env['at']=='nvda' else 'voiceover';assert r['outputKind']=='quoted-reported-speech' and not r['qualityFlags'],(id,r['qualityFlags'])
 cases.append({'id':id,'at':at,'profileId':f"{at}-{env['browser']}-{env['atVersion']}-{env['browserVersion']}",'atVersion':env['atVersion'],'browser':env['browser'],'browserVersion':env['browserVersion'],'osVersion':env['osVersion'],'pattern':pattern(node),'command':r['action']['id'],'elementKind':kind,'node':{**base,**node},'context':{'readingUnit':'single-control','groupContext':'none','language':'en'},'reportedSpeech':r['reportedSpeech'],'semanticInputProvenance':'manual-abstraction-not-native-AX','contextProvenance':'simulation-premise-not-observed-settings','source':{'url':r['source']['url'],'jsonPointer':r['source']['jsonPointer'],'sha256':r['source']['sha256'],'attribution':r['source']['attribution'],'testedOn':env['testedOn'],'commit':PIN},'unknownSettings':['actualOperatingMode','quickNav','verbosity','voice','punctuation','typingEcho','keyboardLayout'],'scopeNote':'Manually authored semantic abstraction and local wording context; not captured native AX/focus telemetry. Name substitution is a bounded simulation rule, not a new observed utterance.'})
for x in load('a11ysupport/formatter-regressions.json'):
 node=x['semanticInput'];role=node['role'];kind='textarea' if node.get('multiline') else 'input-text' if role=='textbox' else 'input-button' if 'tech/html/buttons' in x['observationId'] else 'checkbox' if role=='checkbox' else 'link' if role=='link' else 'button'
 add(x['observationId'],node,kind)
for i in [0,1]:add(f'a11ysupport:tech/html/buttons:nvda:chrome:{i}',{'role':'button','name':'apply'},'input-button')
for i,value in enumerate([False,False,True,True,'mixed','mixed']):add(f'a11ysupport:tech/aria/aria-pressed:nvda:chrome:{i}',{'role':'button','name':'Action','pressed':value},'button')
for i in [0,1]:add(f'a11ysupport:tech/html/links/example1:nvda:chrome:{i}',{'role':'link','name':'sample'},'link')
for i,name in [(0,'Fruit'),(1,'Veggie')]:add(f'a11ysupport:tech/aria/aria-required:nvda:chrome:{i}',{'role':'textbox','name':name,'required':bool(i)},'input-text')
# The old VO fixtures are accepted as existing wording regressions, not proof of inferred context.
groups=[]
for rel,at in [('nvda/summary.json','nvda'),('a11ysupport/normalized-v2/summary.json','voiceover')]:
 for g in load(rel)['groups']:
  groups.append({'source':'a11ysupport',**g,'at':at})
agg={}
for r in load('aria-at/voiceover_observations.json')['records']:
 env=r['environment'];key=(env.get('reported_at_version'),env.get('reported_browser_version'));g=agg.setdefault(key,{'source':'aria-at','at':'voiceover','atVersion':key[0],'browser':'safari','browserVersion':key[1],'osVersion':None,'records':0,'eligibleReportedSpeechRecords':0,'qualityFlagCounts':collections.Counter()})
 g['records']+=1;flags=r['quality_flags'];g['qualityFlagCounts'].update(flags)
 if r['observed_output']['kind']=='reported_at_output' and not any(f in flags for f in ['reported_untestable','possible_test_harness_capture','unusually_long_capture_review_required']):g['eligibleReportedSpeechRecords']+=1
for g in agg.values():g['qualityFlagCounts']=dict(g['qualityFlagCounts']);groups.append(g)
source={'sourceCommit':PIN,'normalizationSchemaVersion':'1.0','voiceoverRecordCount':1290,'nvdaRecordCount':1624,'normalizedNvdaSha256':load('nvda/summary.json')['datasetSha256'],'normalizedVoiceoverSha256':load('a11ysupport/normalized-v2/summary.json')['datasetSha256'],'ariaAtRawResponseSha256':load('aria-at/retrieval.json')['sha256'],'caseCount':len(cases),'nativeMeasurementByRawstep':False,'attribution':'Accessibility Supported: Michael Fairchild and contributors; ARIA-AT: W3C and contributors. See docs/screenreader-evidence.md for distinct licenses.'}
# scopeNote is source metadata and is exposed in fixtures without entering formatter logic.
for c in cases:c.pop('scopeNote')
text="// Generated by scripts/build-evidence-catalog.py; do not alter observed speech.\nimport type { EvidenceCase, EvidenceGroup } from './types.js';\n"
text+='export const EVIDENCE_CATALOG = '+json.dumps(source,ensure_ascii=False,indent=2)+' as const;\n'
text+='export const EVIDENCE_CASES: readonly EvidenceCase[] = '+json.dumps(cases,ensure_ascii=False,indent=2)+';\n'
text+='export const EVIDENCE_GROUPS: readonly EvidenceGroup[] = '+json.dumps(groups,ensure_ascii=False,indent=2)+';\n'
(a.repo/'packages/screenreaders/src/evidence/data.ts').write_text(text)
(a.repo/'tests/fixtures/screenreader-evidence/observed-cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
(e/'nvda/calibration-cases.json').write_text(json.dumps([c for c in cases if c['at']=='nvda'],ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'cases':len(cases),'groups':len(groups),'records':sum(g['records'] for g in groups),'nvdaCases':sum(c['at']=='nvda' for c in cases)}))
