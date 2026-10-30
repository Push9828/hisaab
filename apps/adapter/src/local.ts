import { createServer, type IncomingMessage } from 'node:http';

import { createDb, DrizzleStore } from '@hisaab/db';

import { handleWebhook, parseConfig, type LogLabel } from './telegram';

/**
 * Local webhook server for M3, run behind a tunnel. Listens on 127.0.0.1
 * only. Logs fixed labels only, never bodies or errors (hard rule 8).
 */

const MAX_BODY_BYTES = 64 * 1024;
const HOST = '127.0.0.1';

const config = parseConfig(process.env);
const port = Number(process.env.PORT ?? 8787);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const { db, pool } = createDb(process.env.DATABASE_URL);
const store = new DrizzleStore(db);
const log = (label: LogLabel | 'bad_request') =>
  console.log(`${new Date().toISOString()} ${label}`);

class TooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new TooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer((req, res) => {
  const finish = (status: number, body?: unknown) => {
    if (body === undefined) {
      res.writeHead(status).end();
    } else {
      res
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify(body));
    }
  };

  if (req.method !== 'POST' || req.url !== '/') {
    log('bad_request');
    finish(req.method === 'POST' ? 404 : 405);
    return;
  }

  readBody(req)
    .then((body) =>
      handleWebhook({ headers: req.headers, body }, { config, store, log }),
    )
    .then(({ status, body }) => finish(status, body))
    .catch((err: unknown) => {
      // Never log err: it may hold the request body.
      log(err instanceof TooLarge ? 'bad_request' : 'error');
      finish(err instanceof TooLarge ? 413 : 500);
      if (err instanceof TooLarge) req.destroy();
    });
});

server.listen(port, HOST, () => {
  console.log(`listening on http://${HOST}:${port}`);
});

const shutdown = () => {
  server.close();
  void pool.end();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
