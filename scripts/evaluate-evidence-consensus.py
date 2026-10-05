#!/usr/bin/env python3
"""Separate version-allowlisted consensus and exhaustive family-holdout assessment.
The initial strict fixed split is retained unmodified. This evaluator never adds
heldout versions to an allowlist or obtains output templates from heldout rows.
"""
import argparse,json,pathlib,hashlib,re,collections,importlib.util
p=argparse.ArgumentParser();p.add_argument('--evidence-root',type=pathlib.Path,required=True);p.add_argument('--repo',type=pathlib.Path,required=True);a=p.parse_args();root=a.evidence_root/'pattern-analysis'
rows=json.loads((root/'features-family-v2.json').read_text());calibration_ids={r['id'] for r in json.loads((a.repo/'tests/fixtures/screenreader-evidence/observed-cases.json').read_text())};new_calibration={r['family'] for r in rows if r['id'] in calibration_ids};split={r['id']:('train' if r['family'] in new_calibration else 'heldout' if int(hashlib.sha256(('rawstep-fixture-family-holdout-v1|'+r['family']).encode()).hexdigest()[:8],16)%5==0 else 'train') for r in rows}
initial=json.loads((root/'strict-fixed-split/evaluation.json').read_text());calibration=new_calibration;MIN=2
norm=lambda s:re.sub(r'\s+',' ',re.sub(r'[,.]',' ',str(s).lower())).strip()
WORDS=set('button toggle not pressed selected half checked half-checked checkbox check box unchecked mixed radio link visited edit text field required blank multi line multi-line multiline readonly read only read-only disabled unavailable dimmed collapsed expanded combo combobox pop popup up menu list listbox tree grid dialog group grouping region landmark navigation main banner content information complementary image graphic graphics heading level slider incrementable number spin spinbutton article note status alert tooltip tab switch on off end of secure protected has pop-up search with autofill invalid data entry busy clickable'.split())
def k(r):return json.dumps({'at':r['at'],'browser':r['browser'],'role':r.get('role'),'command':r.get('command'),'flags':r.get('flags',{}),'hasValue':bool(r.get('value')),'beforeMode':r.get('beforeMode')},sort_keys=True,separators=(',',':'))
def version(r):return (r.get('atVersion'),r.get('browserVersion'),r.get('osVersion'))
def template(r):
 s=norm(r['reportedSpeech']);n=norm(r['name']);v=norm(r.get('value',''))
 if n:s=s.replace(n,'{name}')
 if v and v!=n:s=s.replace(v,'{value}')
 if any(t not in WORDS and t not in ['{name}','{value}'] for t in s.split()) or s in ['','{name}','{value}']:return None
 return s
prepared=[(r,k(r),template(r)) for r in rows if r['status']=='features-extracted'];prepared=[x for x in prepared if x[2] is not None]
def learn(excluded_families=set(),fixed=False):
 groups=collections.defaultdict(list)
 for r,key,t in prepared:
  if r['family'] in excluded_families or (fixed and split[r['id']]!='train'):continue
  groups[key].append((r,t))
 rules=[]
 for key,items in sorted(groups.items()):
  per=collections.defaultdict(set)
  for r,t in items:per[version(r)].add(t)
  for tmpl in sorted(set(t for r,t in items)):
   supporting=[r for r,t in items if t==tmpl and len(per[version(r)])==1]
   families=sorted({r['family'] for r in supporting})
   if len(families)<MIN:continue
   versions=sorted({version(r) for r in supporting},key=str)
   id='consensus-'+hashlib.sha256((key+'|'+tmpl+'|'+json.dumps(versions)).encode()).hexdigest()[:16]
   rules.append({'id':id,'key':json.loads(key),'template':tmpl,'allowedVersions':[{'atVersion':v[0],'browserVersion':v[1],'osVersion':v[2]} for v in versions],'trainingFamilies':families,'trainingSourceIds':sorted({r['id'] for r in supporting}),'trainingRecords':len(supporting),'scope':'cross-version-consensus-with-exact-observed-version-allowlist','nativeParityEstablished':False})
 return rules

def evaluate(test_rows,rules,fold):
 idx=collections.defaultdict(list)
 for rule in rules:idx[json.dumps(rule['key'],sort_keys=True,separators=(',',':'))].append(rule)
 out=[]
 for r in test_rows:
  rule=None;reason=r.get('reason');actual=None
  if r['status']=='features-extracted':
   found=[x for x in idx[k(r)] if any((v['atVersion'],v['browserVersion'],v['osVersion'])==version(r) for v in x['allowedVersions'])]
   if len(found)==1:rule=found[0];actual=rule['template'].replace('{name}',norm(r['name'])).replace('{value}',norm(r.get('value','')))
   else:reason='no-unambiguous-rule-in-exact-observed-version-allowlist'
  expected=norm(r.get('reportedSpeech') or '')
  out.append({'id':r['id'],'family':r['family'],'fold':fold,'at':r['at'],'browser':r['browser'],'atVersion':r.get('atVersion'),'browserVersion':r.get('browserVersion'),'osVersion':r.get('osVersion'),'role':r.get('role','unknown'),'command':r.get('command','unknown'),'featureStatus':r['status'],'status':'unsupported' if actual is None else 'exact' if actual==expected else 'mismatch','expected':r.get('reportedSpeech'),'actual':actual,'ruleId':rule['id'] if rule else None,'tokenBagAgreement':actual is not None and collections.Counter(actual.split())==collections.Counter(expected.split()),'unsupportedReason':reason if actual is None else None})
 return out

def metric(items):
 n=len(items);p=sum(r['actual'] is not None for r in items);e=sum(r['status']=='exact' for r in items)
 return {'records':n,'staticFeatureRecords':sum(r['featureStatus']=='features-extracted' for r in items),'predicted':p,'unsupported':n-p,'exactMatches':e,'mismatches':p-e,'tokenBagAgreement':sum(r['tokenBagAgreement'] for r in items),'coverageOverAll':p/n if n else None,'exactOverAll':e/n if n else None,'exactAmongPredicted':e/p if p else None}
fixed_rules=learn(fixed=True);fixed=evaluate([r for r in rows if split[r['id']]=='heldout'],fixed_rules,'fixed-heldout')
lofo=[]
for family in sorted({r['family'] for r in rows}-calibration):lofo+=evaluate([r for r in rows if r['family']==family],learn({family}),family)
# Runtime artifact uses only fixed training partition. No heldout template leaks into it.
summary={'schemaVersion':'1.0','evaluationStatus':'exploratory-validation-after-initial-holdout-inspection','familyGrouping':'semantic fixture signature, output-independent, retains browser/version siblings together','model':'version-allowlisted-consensus-v1','seed':initial['seed'],'minimumTrainingFamilies':MIN,'trainingRuleCount':len(fixed_rules),'fixedHoldout':metric(fixed),'leaveOneUnseenFamilyOut':metric(lofo),'excludedPreviouslyCalibratedRowsFromLofo':sum(r['family'] in calibration for r in rows),'lofoFamilies':len({r['family'] for r in lofo}),'originalStrictFixedSplit':initial['metrics'],'leakageControls':['All records sharing one fixture family, including browser/version siblings, remain together.','Previously hand-calibrated families are training-only and not scored as heldout.','Each LOFO model excludes every record from its evaluated family.','Version allowlists are built only from that fold training data.','Runtime rules use only the deterministic semantic-family training partition, not its heldout labels or LOFO outputs.','Grouping was refined after the initial run to merge near-clone fixtures; these are explicitly exploratory results, not an untouched confirmatory test.'],'limitations':initial['limitations']+['The secondary consensus model pools only identical training templates across versions, then requires the exact AT/browser/OS tuple to have occurred in training.','LOFO and fixed split are separate evaluation designs; neither replaces the unfavorable original result.']}
for field,items in [('fixedByReaderRole',fixed),('lofoByReaderRole',lofo)]:
 summary[field]=[{'at':key[0],'role':key[1],**metric([r for r in items if (r['at'],r['role'])==key])} for key in sorted({(r['at'],r['role']) for r in items})]
for filename,obj in [('consensus-training-rules.json',fixed_rules),('consensus-heldout-results.json',fixed),('leave-one-family-out-results.json',lofo),('consensus-evaluation.json',summary)]: (root/filename).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['fixedByReaderRole','lofoByReaderRole','leakageControls','limitations']},indent=2))
(root/'semantic-family-split.json').write_text(json.dumps([{'id':r['id'],'family':r['family'],'originalFamily':r.get('originalFamily'),'split':split[r['id']]} for r in rows],indent=2)+'\n')
print('RUNTIME RULES',len(fixed_rules),collections.Counter(r['key']['role'] for r in fixed_rules))
