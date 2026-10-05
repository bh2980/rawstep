#!/usr/bin/env python3
"""Retry only failed frozen conditions; restart the identical runtime between fixture cases."""
from pathlib import Path
import json,sys,shutil,subprocess,hashlib,os,time
root=Path(__file__).resolve().parents[2];study=Path(sys.argv[1]).resolve();assets=Path(sys.argv[2]).resolve();python=sys.executable
manifest=json.loads((study/'case-manifest.json').read_text());plan=json.loads((study/'frozen-plan.json').read_text());prior=json.loads((study/'inference/results.json').read_text());missing=[r for r in prior if 'response' not in r]
expected={(c['id'],v['id']) for c in manifest['cases'] for v in plan['variants']};assert {(r['case'],r['variant']) for r in prior}==expected and len(prior)==len(expected)
recovery=study/'recovery';recovery.mkdir();note={'frozenBeforeRecovery':True,'runtimeFailure':json.loads((study/'inference/cleanup.json').read_text()),'successfulOriginalConditions':[(r['case'],r['variant']) for r in prior if 'response'in r],'failedConditionsToRetry':[(r['case'],r['variant']) for r in missing],'unchanged':['screenshots','requests','model weights','model options','prompt templates','history limits','image budgets','thresholds','labels','cache_prompt=false'],'change':'A fresh identical CPU runtime per case prevents cross-case process accumulation. Startup time excluded; timing sessions identified. Original attempts remain immutable.','primaryPlanSha256':hashlib.sha256((study/'frozen-plan.json').read_bytes()).hexdigest()};(recovery/'frozen-recovery-note.json').write_text(json.dumps(note,indent=2)+'\n')
resolved=[{**r,'resultPath':f"inference/{r['case']}--{r['variant']}/result.json",'timingSession':'primary-original'} for r in prior if 'response'in r];attempts=[]
for case in manifest['cases']:
 variants=[v for v in plan['variants'] if (case['id'],v['id']) in [(r['case'],r['variant']) for r in missing]]
 if not variants:continue
 out=recovery/case['id'];out.mkdir();(out/'requests').mkdir();src=study/case['request'];dest=out/'requests/request.json';shutil.copyfile(src,dest);case2={**case,'request':'requests/request.json'}
 (out/'case-manifest.json').write_text(json.dumps({'cases':[case2]},indent=2)+'\n');(out/'frozen-plan.json').write_text(json.dumps({**plan,'variants':variants,'recoverySubset':[(case['id'],v['id']) for v in variants]},indent=2)+'\n')
 for f in ['focus-choices.json','scoring-rubric.json']:shutil.copyfile(study/f,out/f)
 with (out/'console.log').open('w') as log:p=subprocess.run([python,str(root/'scripts/visual-study/run-study.py'),'--study',str(out),'--assets',str(assets)],stdout=log,stderr=subprocess.STDOUT)
 rows=json.loads((out/'inference/results.json').read_text()) if (out/'inference/results.json').exists() else []
 attempts.extend([{**r,'resultPath':str((out/'inference'/f"{r['case']}--{r['variant']}"/'result.json').relative_to(study)),'timingSession':f"recovery/{case['id']}"} for r in rows]);(recovery/'attempts.json').write_text(json.dumps(attempts,indent=2)+'\n')
 resolved.extend(r for r in attempts if r['case']==case['id'] and 'response'in r);(study/'resolved-results.json').write_text(json.dumps(resolved,indent=2)+'\n')
 print(json.dumps({'case':case['id'],'recovered':sum('response'in r for r in rows),'planned':len(variants),'exitCode':p.returncode}),flush=True)
 if p.returncode or len(rows)!=len(variants) or any('response' not in r for r in rows):raise RuntimeError('Recovery case still has missing decisions; preserve evidence and diagnose before continuing')
assert len(resolved)==len(expected) and {(r['case'],r['variant']) for r in resolved}==expected
(study/'recovery-completed.json').write_text(json.dumps({'originalAttempts':len(prior),'originalDecisions':len(prior)-len(missing),'recoveryAttempts':len(attempts),'recoveredDecisions':len(missing),'uniqueCompletedConditions':len(resolved)},indent=2)+'\n')
# A separately frozen eight-comparison sensitivity study; never merge with primary results.
sensitivity=study/'sensitivity';smanifest=json.loads((sensitivity/'case-manifest.json').read_text());splan=json.loads((sensitivity/'frozen-plan.json').read_text());srows=[]
for case in smanifest['cases']:
 out=sensitivity/case['id'];out.mkdir();(out/'requests').mkdir();shutil.copyfile(sensitivity/case['request'],out/'requests/request.json');(out/'case-manifest.json').write_text(json.dumps({'cases':[{**case,'request':'requests/request.json'}]},indent=2)+'\n');(out/'frozen-plan.json').write_text(json.dumps(splan,indent=2)+'\n')
 for f in ['focus-choices.json','scoring-rubric.json']:shutil.copyfile(sensitivity/f,out/f)
 with (out/'console.log').open('w') as log:p=subprocess.run([python,str(root/'scripts/visual-study/run-study.py'),'--study',str(out),'--assets',str(assets)],stdout=log,stderr=subprocess.STDOUT)
 rows=json.loads((out/'inference/results.json').read_text()) if (out/'inference/results.json').exists() else []
 srows.extend([{**r,'resultPath':str((out/'inference'/f"{r['case']}--{r['variant']}"/'result.json').relative_to(study))} for r in rows]);(sensitivity/'results.json').write_text(json.dumps(srows,indent=2)+'\n');print(json.dumps({'sensitivityCase':case['id'],'decisions':sum('response'in r for r in rows),'planned':4}),flush=True)
 if p.returncode or len(rows)!=4 or any('response'not in r for r in rows):raise RuntimeError('Sensitivity case incomplete; preserve evidence')
(study/'model-work-completed.json').write_text(json.dumps({'primaryUniqueDecisions':len(resolved),'sensitivityComparisons':len(srows),'allCaseRuntimesExited':True},indent=2)+'\n')
