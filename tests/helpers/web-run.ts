import { runWithPolicy, type RunOptions } from '@rawstep/core/runner';
import { webSurface, type WebSurfaceOptions } from '@rawstep/browser/surface';
import type { Task } from '@rawstep/core/contracts';

const WEB_KEYS = ['headless', 'browserExecutablePath', 'browserEndpoint', 'copySignIn', 'proxyServer', 'browserSessionFactory', 'observe', 'verifier', 'personCheck'] as const satisfies readonly (keyof WebSurfaceOptions)[];

/**
 * Runs a task on a web page, with the page's options given beside the runner's. Tests that check how the runner and the web surface
 * work together use this; it sorts each option to the one that owns it.
 */
export function runOnWebPage(task: Task, options: Omit<RunOptions, 'surface'> & WebSurfaceOptions): ReturnType<typeof runWithPolicy> {
  const page: WebSurfaceOptions = {}, runner: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if ((WEB_KEYS as readonly string[]).includes(key)) (page as Record<string, unknown>)[key] = value;
    else runner[key] = value;
  }
  return runWithPolicy(task, { ...(runner as Omit<RunOptions, 'surface'>), surface: webSurface(page) });
}
