import { Worker } from 'node:worker_threads';
import { loadEnv, SANDBOX } from '@crms/config';
import { AppError, createLogger } from '@crms/kernel';
import { registerRunner, type SandboxRunner, type ScriptLimits } from './script.js';

const logger = createLogger('sandbox-engine:worker');

/**
 * Worker-thread script runner (PRD §28.2). Opt-in via SANDBOX_RUNNER=worker.
 *
 * Runs user scripts in a separate thread inside a fresh `vm` context with NO
 * Node globals (no require/process/fs/network), a hard wall-clock timeout, and a
 * capped V8 old-space. This gives real isolation from the API process for
 * trusted-tenant scripts. For hostile multi-tenant isolation, register an
 * isolated-vm / Deno / Firecracker runner instead — same seam.
 */
const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
try {
  const sandbox = { input: workerData.input, result: undefined, console: { log: () => {} } };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const wrapped = '"use strict";(function(input){' + workerData.source + '\\n})(input)';
  const value = vm.runInContext(wrapped, context, { timeout: workerData.timeoutMs });
  parentPort.postMessage({ ok: true, value });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
}
`;

class WorkerRunner implements SandboxRunner {
  run(source: string, input: unknown, limits: ScriptLimits): Promise<unknown> {
    const timeoutMs = Math.min(limits.timeoutMs, SANDBOX.maxTimeoutMs);
    const memoryMb = Math.min(limits.memoryMb, SANDBOX.maxMemoryMb);
    return new Promise((resolve, reject) => {
      const worker = new Worker(BOOTSTRAP, {
        eval: true,
        workerData: { source, input, timeoutMs },
        resourceLimits: { maxOldGenerationSizeMb: memoryMb },
      });
      const killer = setTimeout(() => {
        void worker.terminate();
        reject(new AppError('VALIDATION', 'Script exceeded its time limit', { expose: true }));
      }, timeoutMs + 500);

      worker.once('message', (msg: { ok: boolean; value?: unknown; error?: string }) => {
        clearTimeout(killer);
        void worker.terminate();
        if (msg.ok) resolve(msg.value);
        else reject(new AppError('VALIDATION', `Script error: ${msg.error}`, { expose: true }));
      });
      worker.once('error', (err) => {
        clearTimeout(killer);
        reject(new AppError('INTERNAL', `Sandbox worker failed: ${err.message}`));
      });
    });
  }
}

/** Register the worker runner if enabled by config; otherwise leave fail-closed. */
export function registerWorkerRunnerIfEnabled(): boolean {
  if (loadEnv().SANDBOX_RUNNER !== 'worker') return false;
  registerRunner(new WorkerRunner());
  logger.info('Worker-thread sandbox runner registered');
  return true;
}
