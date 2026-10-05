import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

/** Install only each package's declared local closure, independently of the checkout. */
export async function smokePackageClosures(packs, directory, environment) {
  const byName = new Map(packs.map(p=>[p.name,p]));
  const results=[];
  const run=(bin,args,cwd)=>execFileSync(bin,args,{cwd,env:environment,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  for(const target of packs){
    const closure=new Set();const add=name=>{if(closure.has(name))return;closure.add(name);for(const dep of Object.keys(byName.get(name).manifest.dependencies??{}))if(byName.has(dep))add(dep)};add(target.name);
    const cwd=join(directory,'isolated-'+target.name.replaceAll('/','-').replace('@',''));await mkdir(cwd);
    await writeFile(join(cwd,'package.json'),JSON.stringify({name:'isolated-workspace-smoke',private:true,type:'module'}));
    const args=['install','--ignore-scripts','--omit=dev','--no-audit','--no-fund','--package-lock=false',...Array.from(closure,name=>join(directory,byName.get(name).filename))];
    if(process.env.RAWSTEP_SMOKE_OFFLINE==='1')args.push('--offline');run(process.platform==='win32'?'npm.cmd':'npm',args,cwd);
    const expected=target.manifest;
    for(const name of closure){
      const pkg=byName.get(name);const installed=JSON.parse(await readFile(join(cwd,'node_modules',name,'package.json'),'utf8'));assert.deepEqual(installed.dependencies,pkg.manifest.dependencies);
      for(const file of pkg.files){
        assert.match(file.path,/^(?:dist\/|README(?:\.ko)?\.md$|LICENSE$|package\.json$|docs\/[^/]+\.md$|examples\/(?:v2|screenshot|profiles|orca)\/[^/]+\.(?:json|mjs|md|py|txt|html)$|native\/[^/]+\.py$|fixtures\/(?:visual-study\/)?[^/]+\.html$)/);
        assert.doesNotMatch(file.path,/(?:node_modules|\.safetensors$|\.gguf$|\.onnx$|\.node$|\.wasm$|__pycache__)/);
        if(file.path.endsWith('.js')||file.path.endsWith('.d.ts')){
          const text=await readFile(join(cwd,'node_modules',name,file.path),'utf8');assert.doesNotMatch(text,/(?:\/workspace\/|packages\/[^/]+\/src\/|from\s+["'][^"']*\/src\/)/);
        }
      }
    }
    const exports=Object.keys(expected.exports).filter(key=>key!=='./package.json').map(key=>key==='.'?target.name:target.name+'/'+key.slice(2));
    run(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {realpathSync} from 'node:fs';import {fileURLToPath} from 'node:url';for(const name of ${JSON.stringify(exports)}){assert.ok(realpathSync(fileURLToPath(import.meta.resolve(name))).startsWith(process.cwd()+'/node_modules/'));await import(name);}`],cwd);
    await writeFile(join(cwd,'consumer.ts'),exports.map((name,i)=>`import * as module${i} from ${JSON.stringify(name)}; void module${i};`).join('\n'));
    run(process.execPath,[require.resolve('typescript/bin/tsc'),'--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--skipLibCheck','consumer.ts'],cwd);
    if(['@rawstep/core','@rawstep/policies','@rawstep/reports'].includes(target.name))await assert.rejects(access(join(cwd,'node_modules/playwright')));
    if(closure.has('@rawstep/screenreaders'))run(process.execPath,['--input-type=module','-e',`import {orcaBridgePath} from '@rawstep/screenreaders/orca';import {existsSync} from 'node:fs';import assert from 'node:assert/strict';const path=orcaBridgePath();assert.ok(path.startsWith(process.cwd()+'/node_modules/'));assert.ok(existsSync(path));`],cwd);
    if(expected.bin)assert.match(run(process.execPath,[join(cwd,'node_modules',target.name,'dist/cli/bin.js'),'--help'],cwd),/No model or API key is required/);
    if(['@rawstep/cli','rawstep'].includes(target.name)){
      // The dashboard is an optional peer: a CLI install must not pull it or its React UI stack.
      await assert.rejects(access(join(cwd,'node_modules/@rawstep/dashboard')));await assert.rejects(access(join(cwd,'node_modules/react')));
      const ui=(()=>{try{run(process.execPath,[join(cwd,'node_modules',target.name,'dist/cli/bin.js'),'ui','--port','43180'],cwd);return undefined}catch(error){return String(error.stderr)}})();
      assert.match(ui??'ui unexpectedly started',/optional @rawstep\/dashboard/);
    }
    if(target.name==='@rawstep/dashboard') {
      await writeFile(join(cwd,'dashboard-smoke.mjs'), `
import assert from 'node:assert/strict';
import { startDashboard } from '@rawstep/dashboard';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const projectDir=join(process.cwd(),'dashboard-project'); await mkdir(projectDir);
let app=await startDashboard({projectDir,port:0});
try {
  const htmlResponse=await fetch(app.url); assert.equal(htmlResponse.status,200);
  const html=await htmlResponse.text(); assert.match(html,/Rawstep/);
  const asset=html.match(/src="([^" ]+\\.js)"/)[1];
  const js=await fetch(app.url+asset); assert.equal(js.status,200); assert.match(js.headers.get('content-type'),/javascript/); assert.ok((await js.text()).length>1000);
  const state=await (await fetch(app.url+'/api/state')).json(); state.config.globals.headless=false;
  const saved=await fetch(app.url+'/api/config',{method:'PUT',headers:{'content-type':'application/json',origin:app.url},body:JSON.stringify({config:state.config,revision:state.revision})}); assert.equal(saved.status,200);
  await app.close(); app=await startDashboard({projectDir,port:0});
  assert.equal((await (await fetch(app.url+'/api/state')).json()).config.globals.headless,false);
} finally {await app.close();}
`);
      run(process.execPath,['dashboard-smoke.mjs'],cwd);
    }
    results.push({package:target.name,dependencyClosure:[...closure],exportsChecked:exports.length,result:'passed'});
  }
  return results;
}
