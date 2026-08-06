import type { FastifyInstance } from 'fastify';
import { getContext } from '@crms/tenant-context';
import { subscribeTenant } from '@crms/realtime';
import { authed } from '../lib/context.js';

/**
 * Server-Sent Events stream (PRD §34.7). Authenticated clients receive their
 * tenant's domain events in real time. Channels are tenant-scoped in Redis, so a
 * connection can only ever see its own tenant's events.
 */
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/realtime',
    authed(async (req, reply) => {
      const ctx = getContext();
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      raw.write(': connected\n\n');

      const sub = await subscribeTenant(ctx.tenantId, (event) => {
        const e = event as { type?: string };
        raw.write(`event: ${e.type ?? 'message'}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const ping = setInterval(() => raw.write(': ping\n\n'), 25000);

      req.raw.on('close', () => {
        clearInterval(ping);
        void sub.close();
      });
    }),
  );
}
