import { access, readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
const order = ['core','policies','browser','screenreaders','reports','cli','rawstep'];
const dependencyOrder = [...order.slice(0,5), 'dashboard', ...order.slice(5)];
const names = (name:string) => name==='rawstep' ? name : `@rawstep/${name}`;
async function files(path:string):Promise<string[]> { return (await Promise.all((await readdir(path,{withFileTypes:true})).map(d=>d.isDirectory()?files(`${path}/${d.name}`):[`${path}/${d.name}`]))).flat(); }

describe('physical workspace ownership and aggregate verification contract',()=>{
  it('removes retired implementations and root implementation mirrors',async()=>{
    const retired=['action-catalog','agent','config','definition','reporter','runtime'].flatMap(name=>[`packages/${name}/package.json`,`packages/${name}/src`]);
    retired.push('src','apps/cli/package.json','apps/cli/src','rawstep.config.ts','scripts/legacy-cli.cjs');
    retired.push('packages/browser/src/legacy/index.ts','packages/rawstep/src/legacy/index.ts');
    for(const path of retired) await expect(access(resolve(path))).rejects.toThrow();
    expect(await readFile('pnpm-workspace.yaml','utf8')).toContain('packages/*');
  });
  it('has a frozen importer for every real workspace and no mandatory native or model runtime',async()=>{
    const lock=await readFile('pnpm-lock.yaml','utf8');
    expect(lock).not.toMatch(/guidepup|virtual-screen-reader|@ai-sdk|pixelmatch|pngjs|onnxruntime|transformers|torch/);
    const importers=lock.split('\nimporters:\n')[1]!.split('\npackages:\n')[0]!;
    expect(importers.match(/^  \S[^\n]*:/gm)?.sort()).toEqual(['  .:',...order.map(n=>`  packages/${n}:`),'  packages/dashboard:'].sort());
    const dashboard=JSON.parse(await readFile('packages/dashboard/package.json','utf8'));
    expect(dashboard.name).toBe('@rawstep/dashboard');expect(dashboard.private).toBe(true);
    for(const name of order){
      const manifest=JSON.parse(await readFile(`packages/${name}/package.json`,'utf8'));
      expect(manifest.name).toBe(names(name)); expect(manifest.private).not.toBe(true);
      expect(manifest.files).toContain('dist');
      expect(JSON.stringify(manifest.dependencies)).not.toMatch(/guidepup|virtual-screen-reader|@ai-sdk|onnxruntime|transformers|torch|python/);
      const config=JSON.parse(await readFile(`packages/${name}/tsconfig.json`,'utf8'));
      expect(config.compilerOptions.rootDir).toBe('src');expect(config.compilerOptions.outDir).toBe('dist');expect(config.compilerOptions.paths).toBeUndefined();expect(config.include).toEqual(['src/**/*.ts']);
    }
  });
  it('uses only declared package exports across an acyclic package boundary',async()=>{
    for(const name of order){
      const base=resolve(`packages/${name}`),manifest=JSON.parse(await readFile(`${base}/package.json`,'utf8'));
      for(const dep of Object.keys(manifest.dependencies??{}))if(dep.startsWith('@rawstep/')) { expect(dependencyOrder.indexOf(dep.slice(9))).toBeGreaterThanOrEqual(0); expect(dependencyOrder.indexOf(dep.slice(9))).toBeLessThan(dependencyOrder.indexOf(name)); }
      for(const file of (await files(`${base}/src`)).filter(f=>f.endsWith('.ts'))){
        const source=await readFile(file,'utf8');
        for(const [,specifier] of source.matchAll(/(?:from\s*|import\s*\()['"]([^'"\n]+)['"]/g)){
          if(specifier!.startsWith('.'))expect(relative(base,resolve(dirname(file),specifier!))).not.toMatch(/^\.\./);
          else if(!specifier!.startsWith('node:')){
            const dep=specifier!.startsWith('@')?specifier!.split('/').slice(0,2).join('/'):specifier!.split('/')[0]!;
            // Peers count as declared: consumers own playwright and the optional dashboard.
            expect([...Object.keys(manifest.dependencies??{}),...Object.keys(manifest.peerDependencies??{})],`${file}: ${specifier}`).toContain(dep);
            if(dep.startsWith('@rawstep/')){const other=JSON.parse(await readFile(`packages/${dep.slice(9)}/package.json`,'utf8'));expect(Object.keys(other.exports)).toContain(specifier===dep?'.':'./'+specifier!.slice(dep.length+1));}
          }
        }
      }
    }
  });
  it('keeps every behavior test in aggregate execution and typechecking',async()=>{
    const ts=JSON.parse(await readFile('tsconfig.tests.json','utf8'));expect(ts.include).toContain('tests/**/*.ts');expect(ts.exclude).toBeUndefined();
    const config=await readFile('vitest.config.mts','utf8');expect(config).toContain('tests/**/*.test.ts');expect(config).toContain('tests/**/*.integration.test.ts');expect(config).toContain('maxWorkers: 1');expect(config).toContain('fileParallelism: false');
    expect((await readdir('tests')).filter(path=>path.endsWith('.integration.test.ts')).length).toBeGreaterThanOrEqual(3);
  });
  it('requires build, full typecheck, all tests and isolated installed-package smoke',async()=>{
    const manifest=JSON.parse(await readFile('package.json','utf8'));
    expect(manifest.private).toBe(true);expect(manifest.scripts.check).toBe('npm run build && npm run typecheck && npm run test:all && npm run test:package');
    expect(manifest.scripts['test:all']).toBe('npm test && npm run test:integration');
    expect(manifest.scripts.typecheck).toContain('tsconfig.tests.json');expect(manifest.scripts.test).toBe('vitest run');
    expect(manifest.scripts['rawstep:legacy']).toBeUndefined();
  });
});
