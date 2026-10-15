import type {CaseRecord,CaseSet} from './cases.js';
import type {PageState,StateObject} from './state.js';

export interface TaskOutcome {
  controls: {role:string;name:string;state:StateObject['state']}[];
  texts: string[];
}

/** Post-state targets are independent of observed speech and simulator policy input. */
export function evaluateTaskOutcome(oracle:TaskOutcome,state:PageState|undefined){
  if(!oracle.controls.length&&!oracle.texts.length)throw new Error('A task outcome needs a nonempty frozen target');
  const failures:string[]=[],unknown:string[]=[];
  if(!state)return {status:'unmeasured' as const,failures,unknown:['post-state missing']};
  if(state.objectErrors?.length)unknown.push('post-state contains unresolved objects');
  for(const expected of oracle.controls){
    if(!Object.keys(expected.state).length)throw new Error('An outcome control needs a state target');
    const candidates=state.objects?.filter(o=>o.role===expected.role&&o.name===expected.name);
    if(candidates?.length!==1){unknown.push(`control identity unavailable or ambiguous: ${expected.role} ${expected.name}`);continue;}
    for(const [key,value]of Object.entries(expected.state)){
      const observed=candidates[0]!.state[key as keyof StateObject['state']];
      if(observed===undefined)unknown.push(`unobserved ${expected.name}.${key}`);
      else if(observed!==value)failures.push(`${expected.name}.${key}: expected=${JSON.stringify(value)}, observed=${JSON.stringify(observed)}`);
    }
  }
  for(const text of oracle.texts){
    if(!state.texts)unknown.push('exposed static text not recorded');
    else if(!state.texts.includes(text))failures.push(`expected visible result missing: ${text}`);
  }
  return {status:failures.length?'failed' as const:unknown.length?'unmeasured' as const:'success' as const,failures,unknown};
}

export function summarizeTaskOutcomes(set:CaseSet,native:Map<string,CaseRecord>,model:Map<string,CaseRecord>,nativeStates:Map<string,PageState|undefined>){
  const rows=set.cases.filter(c=>c.taskOutcome).map(c=>{
    const evaluate=(record:CaseRecord|undefined,state:PageState|undefined)=>{
      if(!record?.start.aligned||record.error||record.steps.length!==c.chords.length||record.steps.some((s,i)=>s.chord!==c.chords[i]||s.foregroundError||s.reason==='unsupported'))return {status:'incomplete' as const,failures:['planned workflow incomplete, unaligned, unsupported or interrupted'],unknown:[]};
      return evaluateTaskOutcome(c.taskOutcome!,state);
    };
    return {caseId:c.id,native:evaluate(native.get(c.id),nativeStates.get(c.id)),simulator:evaluate(model.get(c.id),model.get(c.id)?.steps.at(-1)?.state)};
  });
  const planned=rows.length;
  const score=(which:'native'|'simulator')=>({success:rows.filter(r=>r[which].status==='success').length,failed:rows.filter(r=>r[which].status==='failed').length,unmeasured:rows.filter(r=>r[which].status==='unmeasured').length,incomplete:rows.filter(r=>r[which].status==='incomplete').length,planned});
  const matched=rows.filter(r=>r.native.status==='success'&&r.simulator.status==='success').length;
  return {status:planned?'frozen-outcome-oracle' as const:'unmeasured' as const,matched,planned,rate:planned?matched/planned:null,native:score('native'),simulator:score('simulator'),rows,
    scope:'Both native and simulator must independently satisfy every predeclared final-state target. Equal failures do not count as success; missing observations and interrupted workflows stay in the planned denominator.'};
}
