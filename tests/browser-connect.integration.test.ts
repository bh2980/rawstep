import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { chromium } from 'playwright';
import { createTestBrowserSession } from './helpers/browser.js';

it('runs in an isolated context of a browser someone else started and leaves that browser running', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'rawstep-connect-'));
  // Stands in for the person's own Chrome: started outside Rawstep with a remote debugging port.
  const owner = await chromium.launchPersistentContext(profile, { headless: true, args: ['--remote-debugging-port=0'],
    ...(process.env.RAWSTEP_TEST_BROWSER_PATH ? { executablePath: process.env.RAWSTEP_TEST_BROWSER_PATH } : {}) });
  try {
    await owner.addCookies([{ name: 'owner', value: '1', url: 'https://safe.example/' }]);
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    const session = await createTestBrowserSession('data:text/html,<button>Go</button>', { cdpEndpoint: `http://127.0.0.1:${port}` });
    expect(session.connected).toBe(true);
    expect(await session.page.getByRole('button', { name: 'Go' }).count()).toBe(1);
    expect(await session.context.cookies('https://safe.example/')).toEqual([]);
    await session.close();
    const ownerPage = await owner.newPage();
    expect(await ownerPage.evaluate(() => 1 + 1)).toBe(2);
    expect((await owner.cookies('https://safe.example/')).map(cookie => cookie.name)).toEqual(['owner']);
  } finally {
    await owner.close();
    await rm(profile, { recursive: true, force: true });
  }
});
