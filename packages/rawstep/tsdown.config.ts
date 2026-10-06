import { readdirSync } from 'node:fs';
import { defineConfig } from 'tsdown';

// Public subpaths = every `src/<name>/index.ts` facade; each one is also an entry of the bundle (`dist/<name>/index.js`).
const subpaths = readdirSync(new URL('./src', import.meta.url), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);

export default defineConfig({
  entry: { index: 'src/index.ts', 'cli/bin': 'src/cli/bin.ts', ...Object.fromEntries(subpaths.map(name => [`${name}/index`, `src/${name}/index.ts`])) },
  format: 'esm',
  fixedExtension: false,
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: true,
  // The internal workspace packages are inlined; only the dependencies in package.json stay external.
  deps: {
    alwaysBundle: [/^@rawstep\//],
    onlyImport: ['ai', '@ai-sdk/openai-compatible', 'playwright', 'zod'],
  },
});
