import type { Page } from 'playwright';
export type NativeZoomController = (page: Page, factor: number) => Promise<{ observedFactor: number; method: string }>;
