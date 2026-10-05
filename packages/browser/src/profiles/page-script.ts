import type { Page } from 'playwright';
/** Keep compiler-added function-name helpers inside the serialized browser closure (tsx/esbuild). */
export async function evaluateProfileScript<T>(page: Page, fn: () => T): Promise<Awaited<T>> {
  return page.evaluate(`(() => { const __name = value => value; return (${fn.toString()})(); })()`) as Promise<Awaited<T>>;
}
export async function installProfileScript<A>(page: Page, fn: (arg: A) => void, argument: A): Promise<void> {
  await page.addInitScript({ content: `(() => { const __name = value => value; (${fn.toString()})(${JSON.stringify(argument)}); })();` });
}
export async function evaluateProfileArguments<A,T>(page: Page, fn: (arg:A) => T, argument:A):Promise<Awaited<T>> {
  return page.evaluate(`(() => { const __name = value => value; return (${fn.toString()})(${JSON.stringify(argument)}); })()`) as Promise<Awaited<T>>;
}
