import { findRawstepError, RawstepError } from '@rawstep/core/errors';
import { BrowserConnectError, createBrowserSession } from '@rawstep/browser/browser';
import { AcpAgent, AcpError } from '@rawstep/policies/acp';
import { providerPreset, type Connection, type MachineSettings } from '@rawstep/project/config';
import { checkResult as result } from '@rawstep/project/checks';
import type { BrowserCheck, ModelCheck } from '../shared/api.js';

// The key and model checks live in the project package, where `rawstep doctor` uses them too.
export { checkConnection, checkModel } from '@rawstep/project/checks';

/** A sign-in may wait for the person to finish it in a browser. */
const SIGN_IN_TIMEOUT_MS = 300_000;

/**
 * Signs a coding-agent CLI in with its own ACP sign-in method, then checks it like `checkConnection`. Only for the person's
 * explicit request (the sign-in button): it can reuse an account the computer is signed in to, or open a sign-in page.
 */
export async function signInAgent(connection: Pick<Connection, 'provider'>): Promise<ModelCheck> {
  const agent = providerPreset(connection).agent;
  if (!agent?.signIn) return result('failed', 'agent');
  const acp = new AcpAgent(agent);
  try { await acp.signIn(agent.signIn, AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)); return result('ready', 'agent'); }
  catch (error) { return result(error instanceof AcpError && error.reason === 'start-failed' ? 'cli-missing' : 'cli-signed-out', 'agent'); }
  finally { await acp.close(); }
}

/**
 * Starts the browser a run would use (the Chrome at the configured debugging address, otherwise the configured executable, otherwise
 * Playwright's Chromium, otherwise installed Chrome), reads its version and closes it again. A launched browser is headless; a
 * connected Chrome shows a blank tab for a moment and is then only disconnected.
 */
export async function checkBrowser(machine: Pick<MachineSettings, 'browserExecutablePath' | 'browserEndpoint'>): Promise<BrowserCheck> {
  const source = machine.browserEndpoint.trim() ? 'connected' : machine.browserExecutablePath.trim() ? 'custom' : 'auto';
  let session: Awaited<ReturnType<typeof createBrowserSession>> | undefined;
  try {
    session = await createBrowserSession('about:blank', { headless: true, observe: false, ...(source === 'connected' ? { cdpEndpoint: machine.browserEndpoint.trim() } : source === 'custom' ? { executablePath: machine.browserExecutablePath.trim() } : {}) });
    return { ok: true, name: 'Chromium', version: session.browser?.version() ?? 'unknown', source };
  } catch (error) {
    const connect = findRawstepError(error, e => e instanceof BrowserConnectError) as BrowserConnectError | undefined;
    if (connect) return { ok: false, kind: `connect-${connect.reason}`, source };
    return { ok: false, kind: source === 'auto' && error instanceof RawstepError && error.code === 'browser-setup' ? 'not-found' : 'launch-failed', source };
  } finally { await session?.close().catch(() => undefined); }
}
