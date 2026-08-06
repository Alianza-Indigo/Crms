import { createLogger } from '@crms/kernel';
import { registerDefaultPdfRenderer } from '@crms/document-engine/pdf';
import { registerWorkerRunnerIfEnabled } from '@crms/sandbox-engine';

const logger = createLogger('api:providers');

/**
 * Wire up credential/flag-gated providers at boot. Each is a registered-provider
 * seam: it activates when its config/dependency is present, otherwise the
 * feature stays cleanly disabled. "Ready — just plug credentials."
 */
export function registerProvidersFromEnv(): void {
  // PDF rendering works out of the box (pure-JS pdfkit).
  registerDefaultPdfRenderer();
  // Script execution stays fail-closed unless SANDBOX_RUNNER=worker.
  const sandbox = registerWorkerRunnerIfEnabled();
  logger.info({ pdf: true, sandbox }, 'Runtime providers registered');
}
