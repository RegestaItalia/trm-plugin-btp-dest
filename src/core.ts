import { createRequire } from 'node:module';

var coreRef: typeof import('trm-core') | undefined;

export function setCore(core: typeof import('trm-core')) {
  coreRef = core;
}

export function getCore(): typeof import('trm-core') {
  if (coreRef) return coreRef;

  if (require?.main?.filename) {
    try {
      const requireFromMain = createRequire(require.main.filename);
      coreRef = requireFromMain('trm-core') as typeof import('trm-core');
      return coreRef;
    } catch { }
  }

  try {
    const resolved = require.resolve('trm-core', { paths: require?.main?.paths ?? [] });
    coreRef = require(resolved) as typeof import('trm-core');
    return coreRef;
  } catch { }

  throw new Error(`Could not resolve 'trm-core'.`);
}