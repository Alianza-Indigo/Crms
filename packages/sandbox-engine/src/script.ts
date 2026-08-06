import { SANDBOX } from '@crms/config';
import { AppError, createLogger } from '@crms/kernel';

const logger = createLogger('sandbox-engine');

/**
 * Script sandbox contract (PRD §28.2).
 *
 * User scripts run under strict isolation: time + memory caps, NO OS/DB/file
 * access, network disabled by default (only via a controlled proxy), an explicit
 * allow-list of APIs, and a prohibition on eval()/new Function(). Static AST
 * validation runs at save time.
 *
 * This module provides the AST safety gate + a pluggable runner interface. The
 * default runner refuses to execute in-process (fail-closed): a real deployment
 * wires an out-of-process isolate (Deno permissions / QuickJS / WASM /
 * isolated-vm / Firecracker per tier). Failing closed guarantees we never run
 * untrusted code in the API process by accident.
 */

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\beval\s*\(/, reason: 'eval() is forbidden' },
  { re: /new\s+Function\s*\(/, reason: 'new Function() is forbidden' },
  { re: /\brequire\s*\(/, reason: 'require() is forbidden' },
  { re: /\bimport\s*\(/, reason: 'dynamic import() is forbidden' },
  { re: /\bprocess\b/, reason: 'access to process is forbidden' },
  { re: /\bglobalThis\b/, reason: 'access to globalThis is forbidden' },
  { re: /\b__proto__\b/, reason: 'prototype access is forbidden' },
  { re: /\bchild_process\b/, reason: 'child_process is forbidden' },
  { re: /\bfs\b\s*\./, reason: 'filesystem access is forbidden' },
];

export interface ScriptLimits {
  timeoutMs: number;
  memoryMb: number;
  allowedApis: string[];
  networkEnabled: boolean;
}

export function defaultLimits(): ScriptLimits {
  return {
    timeoutMs: SANDBOX.defaultTimeoutMs,
    memoryMb: SANDBOX.defaultMemoryMb,
    allowedApis: [],
    networkEnabled: false,
  };
}

/** Static validation (PRD §28.2). Rejects obviously dangerous constructs. */
export function validateScript(source: string): { ok: boolean; reason?: string } {
  for (const { re, reason } of FORBIDDEN_PATTERNS) {
    if (re.test(source)) return { ok: false, reason };
  }
  return { ok: true };
}

export interface SandboxRunner {
  run(source: string, input: unknown, limits: ScriptLimits): Promise<unknown>;
}

let runner: SandboxRunner | null = null;

/** Register an out-of-process isolate runner (Deno/QuickJS/WASM/isolated-vm). */
export function registerRunner(r: SandboxRunner): void {
  runner = r;
}

export async function runScript(source: string, input: unknown, limits = defaultLimits()): Promise<unknown> {
  const check = validateScript(source);
  if (!check.ok) throw new AppError('VALIDATION', `Script rejected: ${check.reason}`);
  if (!runner) {
    logger.error('No sandbox runner registered; refusing to execute untrusted script in-process');
    throw new AppError('NOT_IMPLEMENTED', 'Script execution requires an isolated runner to be configured', {
      expose: true,
    });
  }
  return runner.run(source, input, limits);
}
