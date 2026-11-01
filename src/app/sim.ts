// Real simulation: the core engine runs inside a Web Worker and is reached through Comlink.
import * as Comlink from 'comlink';
import type { SimApi } from './store';
import type { SimApi as WorkerApi } from '../worker/sim.worker';

export function createSimApi(): SimApi {
  const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<WorkerApi>(worker);
  return {
    newCareer: (cmd) => remote.newCareer(cmd),
    apply: (cmd) => remote.apply(cmd),
    load: (json) => remote.load(json),
    exportSave: () => remote.export(),
  };
}
