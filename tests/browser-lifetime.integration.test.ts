import { expect, it } from 'vitest';
import { launchTestBrowser } from './helpers/browser.js';

it('closes the exact owned Chrome process IDs before another browser is launched', async () => {
  const browser = await launchTestBrowser();
  const connection = await browser.newBrowserCDPSession();
  const { processInfo } = await connection.send('SystemInfo.getProcessInfo');
  const ids = processInfo.map(process => process.id);
  expect(ids.length).toBeGreaterThan(0);
  expect(processInfo.some(process => process.type === 'browser')).toBe(true);
  await connection.detach();
  await browser.close();
  // Signal zero only checks existence. Never terminate a browser/process.
  const alive = (id: number) => {
    try { process.kill(id, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
  };
  await expect.poll(() => ids.filter(alive), { timeout: 5_000 }).toEqual([]);
});
