import { createRequire } from 'node:module';

var commonsRef: typeof import('trm-commons') | undefined;

export function setCommons(commons: typeof import('trm-commons')) {
  commonsRef = commons;
}

export function getCommons(): typeof import('trm-commons') {
  if (commonsRef) return commonsRef;

  if (require?.main?.filename) {
    try {
      const requireFromMain = createRequire(require.main.filename);
      commonsRef = requireFromMain('trm-commons') as typeof import('trm-commons');
      return commonsRef;
    } catch { }
  }

  try {
    const resolved = require.resolve('trm-commons', { paths: require?.main?.paths ?? [] });
    commonsRef = require(resolved) as typeof import('trm-commons');
    return commonsRef;
  } catch { }

  throw new Error(`Could not resolve 'trm-commons'.`);
}