import net from 'node:net';
import { loadEnv } from '@crms/config';
import { AppError, createLogger } from '@crms/kernel';

const logger = createLogger('storage:antivirus');

export interface ScanResult {
  scanned: boolean;
  clean: boolean;
  signature?: string;
}

/**
 * Scan a buffer with ClamAV (clamd) using the INSTREAM protocol over TCP
 * (PRD §32.2). When CLAMAV_HOST is unset scanning is skipped (fail-open, dev);
 * set CLAMAV_HOST/CLAMAV_PORT to enforce. Never uploads content that clamd
 * reports as infected.
 */
export function scanBuffer(buf: Buffer): Promise<ScanResult> {
  const env = loadEnv();
  if (!env.CLAMAV_HOST) return Promise.resolve({ scanned: false, clean: true });
  const host = env.CLAMAV_HOST;
  const port = env.CLAMAV_PORT ?? 3310;

  return new Promise<ScanResult>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = '';
    const CHUNK = 64 * 1024;

    socket.setTimeout(30_000);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new AppError('DEPENDENCY_FAILED', 'Antivirus scan timed out', { expose: false }));
    });
    socket.on('error', (err) => reject(new AppError('DEPENDENCY_FAILED', `Antivirus unreachable: ${err.message}`, { expose: false })));
    socket.on('data', (d) => {
      response += d.toString('utf8');
    });
    socket.on('end', () => {
      const text = response.trim();
      // "stream: OK"  |  "stream: Eicar-Test-Signature FOUND"
      if (/OK$/.test(text)) return resolve({ scanned: true, clean: true });
      const m = text.match(/:\s(.+)\sFOUND$/);
      logger.warn({ signature: m?.[1] }, 'Antivirus flagged content');
      resolve({ scanned: true, clean: false, signature: m?.[1] });
    });

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += CHUNK) {
        const slice = buf.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(slice.length, 0);
        socket.write(size);
        socket.write(slice);
      }
      const terminator = Buffer.alloc(4); // 0-length chunk ends the stream
      socket.write(terminator);
    });
  });
}

/** Scan and throw a client-safe error if the content is infected. */
export async function assertClean(buf: Buffer): Promise<void> {
  const res = await scanBuffer(buf);
  if (res.scanned && !res.clean) {
    throw new AppError('VALIDATION', `File rejected: malware detected (${res.signature ?? 'unknown'})`, { expose: true });
  }
}
