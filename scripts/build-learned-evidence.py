#!/usr/bin/env python3
"""Generate deployable artifacts from training rules only; heldout labels remain evaluation data."""
import argparse,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--evidence-root',type=pathlib.Path,required=True);p.add_argument('--repo',type=pathlib.Path,required=True);a=p.parse_args();root=a.evidence_root/'pattern-analysis'
rules=json.loads((root/'consensus-training-rules.json').read_text());rows=json.loads((root/'features-family-v2.json').read_text());families={}
for r in rows:families.setdefault(r['family'],set()).add(r.get('originalFamily',r['family']))
for r in rules:r['trainingFixturePaths']=sorted({path for f in r['trainingFamilies'] for path in families[f]})
summary=json.loads((root/'consensus-evaluation.json').read_text())
(a.repo/'packages/screenreaders/src/evidence/learned-data.ts').write_text('// Generated solely from the semantic-family training partition.\nexport const LEARNED_CORPUS_RULES = '+json.dumps(rules,indent=2)+' as const;\nexport const CORPUS_EVALUATION = '+json.dumps(summary,indent=2)+' as const;\n')
print(json.dumps({'deployedTrainingRules':len(rules),'defaultGeneralization':'abstain on unknown fixture family/version/state/command','nativeParityEstablished':False}))
