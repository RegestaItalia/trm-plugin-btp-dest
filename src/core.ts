import { createRequire } from 'node:module';
import type * as TrmCore from 'trm-core';

let coreRef: typeof import('trm-core') | undefined;

export function setCore(core: typeof import('trm-core')) {
  coreRef = core;
}

export function getCore(): typeof import('trm-core') {
  if (coreRef) return coreRef;
  const requireFromHost = createRequire(process.cwd() + '/package.json');
  coreRef = requireFromHost('trm-core') as typeof import('trm-core');
  return coreRef;
}

export type {
  Login,
  RESTConnection,
  RESTSystemConnector,
} from 'trm-core';