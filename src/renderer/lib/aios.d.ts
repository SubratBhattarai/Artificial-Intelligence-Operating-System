import type { AiosApi } from '../../preload/index';

declare global {
  interface Window {
    aios?: AiosApi;
  }
}

export {};

declare global {
  interface Window {
    __openTrace?: unknown[];
  }
}

declare global {
  interface Window {
    __keyTrace?: unknown[];
    __ptrTrace?: unknown[];
  }
}
