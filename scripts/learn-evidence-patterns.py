#!/usr/bin/env python3
"""Learn explicit wording templates from training families, then evaluate heldout families.
No model weights or test labels are used for template selection. Unsupported rows
remain in evaluation denominators. Existing hand-calibrated families cannot enter
holdout. Family grouping spans browsers and recorded AT versions.
"""
import argparse,json,pathlib,hashlib,re,collections
p=argparse.ArgumentParser();p.add_argument('--evidence-root',type=pathlib.Path,required=True);p.add_argument('--repo',type=pathlib.Path,required=True);a=p.parse_args();root=a.evidence_root/'pattern-analysis';rows=json.loads((root/'features.json').read_text())
SEED='rawstep-fixture-family-holdout-v1';MIN_FAMILIES=2
norm=lambda s:re.sub(r'\s+',' ',re.sub(r'[,.]',' ',str(s).lower())).strip()
# Predetermined role/state vocabulary bounds templates. Unknown residual page words
# are not memorized as universal constants. These words are not obtained from holdout.
WORDS=set('button toggle not pressed selected half checked half-checked checkbox check box unchecked mixed radio link visited edit text field required blank multi line multi-line multiline readonly read only read-only disabled unavailable dimmed collapsed expanded combo combobox pop popup up menu list listbox tree grid dialog group grouping region landmark navigation main banner content information complementary image graphic graphics heading level slider incrementable number spin spinbutton article note status alert tooltip tab switch on off end of secure protected has pop-up search with autofill invalid data entry busy clickable'.split())
calibration=json.loads((a.repo/'tests/fixtures/screenreader-evidence/observed-cases.json').read_text());known_ids={c['id'] for c in calibration};calibrated_families={r['family'] for r in rows if r['id'] in known_ids}
def split(f):return 'train' if f in calibrated_families else 'heldout' if int(hashlib.sha256((SEED+'|'+f).encode()).hexdigest()[:8],16)%5==0 else 'train'
def key(r):return json.dumps({'at':r['at'],'browser':r['browser'],'atVersion':r.get('atVersion'),'browserVersion':r.get('browserVersion'),'role':r.get('role'),'command':r.get('command'),'flags':r.get('flags',{}),'hasValue':bool(r.get('value')),'beforeMode':r.get('beforeMode')},sort_keys=True,separators=(',',':'))
def template(r):
 speech=norm(r['reportedSpeech']);n=norm(r['name']);v=norm(r.get('value',''))
 if n: speech=speech.replace(n,'{name}')
 if v and v!=n:speech=speech.replace(v,'{value}')
 if any(w not in WORDS and w not in ['{name}','{value}'] for w in speech.split()):return None
 if not speech or speech in ['{name}','{value}']:return None
 return speech
train=[r for r in rows if split(r['family'])=='train'];held=[r for r in rows if split(r['family'])=='heldout']
assert not ({r['family'] for r in train}&{r['family'] for r in held})
assert not (calibrated_families & {r['family'] for r in held})
candidates=collections.defaultdict(list);excluded=collections.Counter()
for r in train:
 if r['status']!='features-extracted':excluded[r.get('reason','no-features')]+=1;continue
 t=template(r)
 if t is None:excluded['unmodeled-output-context-or-value']+=1;continue
 candidates[key(r)].append((r,t))
rules=[];rejected=[]
for k,items in sorted(candidates.items()):
 templates=set(t for r,t in items);families=set(r['family'] for r,t in items)
 if len(templates)!=1:rejected.append({'key':json.loads(k),'reason':'conflicting-training-templates','templates':sorted(templates),'records':len(items),'families':len(families)});continue
 if len(families)<MIN_FAMILIES:rejected.append({'key':json.loads(k),'reason':'fewer-than-two-independent-training-families','records':len(items),'families':len(families)});continue
 id='rule-'+hashlib.sha256(k.encode()).hexdigest()[:16]
 rules.append({'id':id,'key':json.loads(k),'template':next(iter(templates)),'trainingSourceIds':sorted({r['id'] for r,t in items}),'trainingFamilies':sorted(families),'trainingRecords':len(items),'scope':'version-command-state-specific-simulated-wording','nativeParityEstablished':False})
bykey={json.dumps(r['key'],sort_keys=True,separators=(',',':')):r for r in rules}
results=[]
for r in held:
 actual=None;rule=None;reason=r.get('reason')
 if r['status']=='features-extracted':
  rule=bykey.get(key(r))
  if rule:actual=rule['template'].replace('{name}',norm(r['name'])).replace('{value}',norm(r.get('value','')))
  else:reason='no-unambiguous-multi-family-training-rule'
 expected=norm(r.get('reportedSpeech') or '')
 results.append({'id':r['id'],'family':r['family'],'at':r['at'],'browser':r['browser'],'atVersion':r.get('atVersion'),'browserVersion':r.get('browserVersion'),'role':r.get('role','unknown'),'command':r.get('command','unknown'),'featureStatus':r['status'],'ruleId':rule['id'] if rule else None,'expected':r.get('reportedSpeech'),'actual':actual,'status':'unsupported' if actual is None else 'exact' if actual==expected else 'mismatch','tokenBagAgreement':actual is not None and collections.Counter(actual.split())==collections.Counter(expected.split()),'unsupportedReason':reason if actual is None else None})
def metric(items):
 predicted=[r for r in items if r['actual'] is not None];exact=sum(r['status']=='exact' for r in items)
 return {'records':len(items),'staticFeatureRecords':sum(r['featureStatus']=='features-extracted' for r in items),'predicted':len(predicted),'unsupported':len(items)-len(predicted),'exactMatches':exact,'tokenBagAgreement':sum(r['tokenBagAgreement'] for r in items),'coverageOverAll':len(predicted)/len(items) if items else None,'exactOverAll':exact/len(items) if items else None,'exactAmongPredicted':exact/len(predicted) if predicted else None}
per=[]
for k in sorted({(r['at'],r['browser'],r['role']) for r in results}):per.append({'at':k[0],'browser':k[1],'role':k[2],**metric([r for r in results if (r['at'],r['browser'],r['role'])==k])})
summary={'schemaVersion':'1.0','seed':SEED,'minimumIndependentTrainingFamilies':MIN_FAMILIES,'sourceRecords':len(rows),'trainRecords':len(train),'heldoutRecords':len(held),'trainFamilies':len({r['family'] for r in train}),'heldoutFamilies':len({r['family'] for r in held}),'priorCalibrationFamiliesForcedToTrain':sorted(calibrated_families),'splitLeakageChecks':{'familyOverlap':False,'priorCalibrationInHoldout':False,'browserAndVersionSiblingsStayTogether':True},'learnedRuleCount':len(rules),'candidateKeys':len(candidates),'rejectedKeys':len(rejected),'metrics':metric(results),'byReaderBrowserRole':per,'trainingExclusions':dict(excluded),'heldoutUnsupportedReasons':dict(collections.Counter(r['unsupportedReason'] for r in results if r['status']=='unsupported')),'limitations':['Static HTML and declared target/setup are not native AX or observed focus/cursor.','All source AT settings remain unknown where not reported.','Only unambiguous isolated navigation targets can produce features.','ARIA-AT sequence target alignment remains unsupported in this evaluator and is counted in the full denominator.','Exact means case/whitespace/comma/full-stop-normalized speech agreement.','Token bag agreement ignores order and is only a lexical proxy, not accessibility semantic correctness.','No heldout label influenced templates or conflict selection; poor coverage is retained, not repaired from test labels.','This is a rule-based corpus assessment, not native VO/NVDA performance or universal mock accuracy.']}
for name,data in [('training-rules.json',rules),('rejected-patterns.json',rejected),('heldout-results.json',results),('evaluation.json',summary),('split-manifest.json',[{'id':r['id'],'family':r['family'],'split':split(r['family'])} for r in rows])]: (root/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['byReaderBrowserRole','trainingExclusions','heldoutUnsupportedReasons','priorCalibrationFamiliesForcedToTrain','limitations']},indent=2))
print('RULES',[(r['key']['at'],r['key']['browser'],r['key']['role'],r['key']['command'],r['template'],len(r['trainingFamilies'])) for r in rules])
