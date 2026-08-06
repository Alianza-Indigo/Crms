import { describe, it, expect } from 'vitest';
import { renderHtmlToPdf } from '@crms/document-engine/pdf';
import { resetEnvCache } from '@crms/config';

/**
 * Runtime providers that are "ready — just plug credentials/enable":
 * the default PDF renderer and the opt-in worker-thread sandbox runner.
 */
describe('PDF renderer (pdfkit)', () => {
  it('renders HTML to a real PDF buffer', async () => {
    const buf = await renderHtmlToPdf('<h1>Quote</h1><p>Total: $1,234</p><ul><li>A</li><li>B</li></ul>');
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('worker-thread sandbox runner (opt-in)', () => {
  it('executes a trusted script and enforces the timeout', async () => {
    process.env.SANDBOX_RUNNER = 'worker';
    resetEnvCache();
    const sandbox = await import('@crms/sandbox-engine');
    sandbox.registerWorkerRunnerIfEnabled();

    const result = await sandbox.runScript('return input.a + input.b;', { a: 2, b: 40 });
    expect(result).toBe(42);

    await expect(sandbox.runScript('while (true) {}', {}, { timeoutMs: 300, memoryMb: 32, allowedApis: [], networkEnabled: false })).rejects.toThrow(
      /tim(e|ed)/i,
    );

    delete process.env.SANDBOX_RUNNER;
    resetEnvCache();
  });
});
