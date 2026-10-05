/** Opt-in native image delivery diagnostic. No browser, model fallback, or private page data. */
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { loadCliEnvironment } from '../packages/cli/dist/cli/config.js';
import { OpenRouterSystemOneClient } from '@rawstep/policies/systemone';
import { writeJsonAtomic } from '@rawstep/core/trace';

const model = process.argv[2] ?? 'cloudflare/clef-flash';
if (process.argv.length > 3 || !/^[a-z0-9._:-]+\/[a-z0-9._:-]+$/i.test(model))
  throw new Error('Usage: node scripts/check-openrouter-images.mjs [MODEL_ID]');
const env = await loadCliEnvironment(process.cwd());
const apiKey = env.RAWSTEP_DECISION_OPENROUTER_API_KEY ??
  (env.RAWSTEP_DECISION_PROVIDER === 'openrouter-systemone' ? env.RAWSTEP_DECISION_API_KEY : undefined);
if (!apiKey) throw new Error('An OpenRouter API key is required; credentials are never printed.');
const client = new OpenRouterSystemOneClient({ baseURL: 'https://openrouter.ai/api/v1', model, apiKey, timeoutMs: 15000,
  capabilities: { inputs: ['text', 'image'], maxImages: 2, maxChoices: 255 } });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const kind = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([size, kind, data, crc]);
}
function png(rgb) {
  const width = 256, height = 256, header = Buffer.alloc(13), rows = Buffer.alloc((width * 3 + 1) * height);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    for (let c = 0; c < 3; c++) rows[y * (width * 3 + 1) + 1 + x * 3 + c] = rgb[c];
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const fixtures = [['red', png([255, 0, 0])], ['blue', png([0, 0, 255])]];
const state = { purpose: 'Visual connection diagnostic' };
const choices = [{ id: 'red', label: 'The image is red' }, { id: 'blue', label: 'The image is blue' }];
const instructions = 'What is the dominant color in the attached image?';
const results = [];
let passed = true;
const cases = [
  ...fixtures.map(([color, image]) => ({ name: color, images: [image], expected: color, instructions })),
  { name: 'absent', images: [], instructions },
  { name: 'first-red-then-blue', images: [fixtures[0][1], fixtures[1][1]], expected: 'red', instructions: 'What is the dominant color in the FIRST attached image?' },
  { name: 'first-blue-then-red', images: [fixtures[1][1], fixtures[0][1]], expected: 'blue', instructions: 'What is the dominant color in the FIRST attached image?' },
];
for (const test of cases) {
  try {
    const result = await client.evaluate({ state, instructions: test.instructions, choices,
      images: test.images.map(pngBase64 => ({ pngBase64 })) }, { signal: new AbortController().signal });
    const row = { fixture: test.name, choice: result.choiceId, probabilities: result.probabilities, model: result.model,
      ...(test.expected ? { passed: result.choiceId === test.expected } : { control: true }) };
    if (test.expected && !row.passed) passed = false;
    results.push(row); console.log(JSON.stringify(row));
  } catch { passed = false; const row = { fixture: test.name, passed: false, error: 'Request failed; details omitted.' }; results.push(row); console.log(JSON.stringify(row)); }
}
// Bypass local PNG validation only for this malformed-image upstream negative control.
try {
  const response = await fetch('https://openrouter.ai/api/v1/systemone', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, state: [{ type: 'text', text: JSON.stringify(state) },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,THIS_IS_NOT_A_PNG' } }],
    questions: { next: { type: 'choice', instructions, criteria: Object.fromEntries(choices.map(c => [c.id, c.label])) } },
    provider: { allow_fallbacks: false } }),
  });
  const rejected = response.status === 400 || response.status === 422;
  await response.body?.cancel(); passed &&= rejected;
  const row = { fixture: 'invalid-png', status: response.status, passed: rejected }; results.push(row); console.log(JSON.stringify(row));
} catch { passed = false; results.push({ fixture: 'invalid-png', passed: false, error: 'Request failed; details omitted.' }); }
const out = resolve('.rawstep', `openrouter-image-check-${randomUUID()}`);
await mkdir(out, { recursive: true });
await writeJsonAtomic(resolve(out, 'image-delivery-check.json'), { status: passed ? 'passed' : 'incomplete', model,
  endpoint: 'https://openrouter.ai/api/v1/systemone', imageEncoding: 'state-content-parts', results,
  limitations: ['Synthetic visual delivery and ordering check only, not measured model accuracy or accessibility certification.'] });
console.log(`Evidence: ${out}`);
if (!passed) process.exitCode = 1;
