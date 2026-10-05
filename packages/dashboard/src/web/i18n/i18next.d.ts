import 'i18next';
import type { resources } from './index.js';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: (typeof resources)['ko'];
  }
}
