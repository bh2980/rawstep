#!/usr/bin/env python3
"""Frozen, local-only score study. Source requests and independent labels are kept separate."""
from pathlib import Path
import argparse,base64,copy,hashlib,importlib.util,json,os,signal,subprocess,time,urllib.request

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--study',type=Path,required=True);parser.add_argument('--assets',type=Path,required=True);args=parser.parse_args()
 root=Path(__file__).resolve().parents[2];study=args.study.resolve();assets=args.assets.resolve();out=study/'inference'
 if out.exists():raise RuntimeError('A fresh inference directory is required; evidence is never overwritten')
 out.mkdir();(out/'sources').mkdir();(out/'sources'/'run-study.py').write_bytes(Path(__file__).read_bytes());(out/'sources'/'onejev4b_server.py').write_bytes((root/'examples/screenshot/onejev4b_server.py').read_bytes());plan=json.loads((study/'frozen-plan.json').read_text());manifest=json.loads((study/'case-manifest.json').read_text())
 os.environ['RAWSTEP_ONEJEV_ASSETS']=str(assets)
 source=root/'examples/screenshot/onejev4b_server.py';spec=importlib.util.spec_from_file_location('bridge',source);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 cmd=[str(assets/'runtime/llama-b11146/llama-server'),'--host','127.0.0.1','--port','8768','-m',str(assets/'model/OneJev-4B.Q4_K_M.gguf'),'--mmproj',str(assets/'model/OneJev-4B.mmproj-f16.gguf'),'--no-mmproj-offload','-ngl','0','-np','1','-c','4096','-t','6','-tb','6','-b','512','-ub','128','--image-min-tokens','64','--image-max-tokens','768','--fit','off']
 save(out/'provenance.json',{'planSha256':digest(study/'frozen-plan.json'),'casesSha256':digest(study/'case-manifest.json'),'labelsSha256':digest(study/'scoring-rubric.json'),'bridgeSha256':digest(source),'runtimeCommand':cmd,'modelManifest':json.loads((assets/'model-manifest.json').read_text()),'runtimeManifest':json.loads((assets/'runtime-manifest.json').read_text()),'cachePrompt':False,'baselinePixelBudgetUnchanged':True,'maximumImageTokensAllowsHigherResolutionVariant':768})
 log=(out/'llama.log').open('w');proc=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);log.close();began=time.monotonic();results=[]
 try:
  for _ in range(480):
   if proc.poll() is not None:raise RuntimeError('Runtime exited before ready')
   try:
    with urllib.request.urlopen('http://127.0.0.1:8768/health',timeout=1) as r:health=json.load(r)
    break
   except OSError:time.sleep(.25)
  else:raise TimeoutError('Runtime startup deadline')
  policy=mod.OneJevPolicy('http://127.0.0.1:8768',out/'backend-receipts.jsonl');policy.cache_prompt=False;policy.info['cachePrompt']=False;save(out/'runtime-props.json',policy.props)
  focus_choices=json.loads((study/'focus-choices.json').read_text())
  for case in manifest['cases']:
   original=json.loads((study/case['request']).read_text())
   assert digest(study/case['request'])==case['requestSha256']
   for v in plan['variants']:
    policy.max_pixels=v['maxPixels'];policy.history_limit=v['historyLimit'];policy.info={**policy.info,'maxPixels':v['maxPixels'],'historyLimit':v['historyLimit']}
    req=copy.deepcopy(original);row={'case':case['id'],'split':case['split'],'family':case['family'],'variant':v['id'],'requestSha256':case['requestSha256']};caseout=out/(case['id']+'--'+v['id']);caseout.mkdir()
    start=time.monotonic()
    try:
     if v['focusGate']:
      focus_req={**copy.deepcopy(req),'purpose':'focus-context','choices':copy.deepcopy(focus_choices)};save(caseout/'focus-request.json',focus_req)
      focus=policy.choose(focus_req);save(caseout/'focus-response.json',focus);row['focus']=focus
      scores=focus['probabilities'];idx=next(i for i,c in enumerate(focus_choices) if c['id']==focus['choiceId']);confident=scores[idx]>=.75 and scores[idx]-max(p for i,p in enumerate(scores) if i!=idx)>=.25
      editable=confident and focus['choiceId']=='focus:editable-target';activate=confident and focus['choiceId']=='focus:activation-target'
      def allowed(c):
       a=c['decision'].get('action')
       if not a:return True
       if a['kind'] in ['typeText','replaceText']:return editable
       if a['kind']!='key':return False
       if a['key']=='Enter':return editable or activate
       if a['key']=='Space':return activate
       if a['key'] in ['Backspace','Delete']:return editable
       return True
      req['choices']=[c for c in req['choices'] if allowed(c)]
      row['blockedChoiceIds']=[c['id'] for c in original['choices'] if not allowed(c)]
     save(caseout/'action-request.json',req)
     prompt,_,_=policy.prepare(req);(caseout/'action-prompt.txt').write_text(prompt)
     result=policy.choose(req);save(caseout/'action-response.json',result);row['response']=result
    except Exception as e:row['error']={'type':type(e).__name__,'message':str(e)}
    
    try:row['runtimeMemory']={line.split(':',1)[0]:line.split(':',1)[1].strip() for line in Path(f'/proc/{proc.pid}/status').read_text().splitlines() if line.startswith(('VmRSS:','VmHWM:'))}
    except OSError:row['runtimeMemory']=None
    row['totalMs']=round((time.monotonic()-start)*1000,2);save(caseout/'result.json',row);results.append(row);save(out/'results.json',results)
    print(json.dumps({'case':case['id'],'variant':v['id'],'choiceId':row.get('response',{}).get('choiceId'),'error':row.get('error'),'totalMs':row['totalMs']}),flush=True)
 finally:
  alive_before_cleanup=proc.poll() is None
  if proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(15)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
  save(out/'cleanup.json',{'runtimeAliveBeforeCleanup':alive_before_cleanup,'runtimeExited':proc.poll() is not None,'returncode':proc.returncode,'durationMs':round((time.monotonic()-began)*1000,2),'completedComparisons':len(results)})
if __name__=='__main__':main()
