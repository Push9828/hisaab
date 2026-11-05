import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { createDb, DrizzleStore } from '@hisaab/db';

import { sarvamCategorizer, sarvamReportPicker } from './sarvam';
import {
  handleWebhook,
  hasValidSecret,
  parseConfig,
  type LogLabel,
} from './telegram';

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
const sarvamKey = process.env.SARVAM_API_KEY;
const categorizer = sarvamKey ? sarvamCategorizer(sarvamKey) : undefined;
const reportPicker = sarvamKey ? sarvamReportPicker(sarvamKey) : undefined;
const log = (label: LogLabel | 'bad_request' | 'aborted') =>
  console.log(`${new Date().toISOString()} ${label}`);

// A dropped idle connection emits 'error' on the pool; unhandled, it would
// crash with a stack trace.
pool.on('error', () => log('error'));

try {
  await pool.query('select 1');
} catch {
  // The pg error can include connection details. Print a fixed line only.
  console.error('database unreachable: check DATABASE_URL and pnpm db:up');
  process.exit(1);
}

// From here on, anything unexpected prints a label, never a stack trace.
process.on('uncaughtException', () => {
  log('error');
  process.exit(1);
});
process.on('unhandledRejection', () => {
  log('error');
  process.exit(1);
});

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

/** Answers without reading the body, and closes the connection after. */
function reject(res: ServerResponse, status: number) {
  res.writeHead(status, { connection: 'close' }).end();
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST' || req.url !== '/') {
    log('bad_request');
    reject(res, req.method === 'POST' ? 404 : 405);
    return;
  }
  // Checked again in handleWebhook; here it stops strangers before we read a byte.
  if (!hasValidSecret(req.headers, config.secret)) {
    log('unauthorized');
    reject(res, 401);
    return;
  }

  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err instanceof TooLarge) {
      log('bad_request');
      reject(res, 413);
    } else {
      log('aborted'); // the client went away mid-body; nobody to answer
    }
    return;
  }

  const { status, body: reply } = await handleWebhook(
    { headers: req.headers, body },
    { config, store, log, categorizer, reportPicker },
  );
  if (reply === undefined) {
    res.writeHead(status).end();
  } else {
    res
      .writeHead(status, { 'content-type': 'application/json' })
      .end(JSON.stringify(reply));
  }
}

// Node only checks the timeouts below every connectionsCheckingInterval
// (default 30s), so check often enough for them to mean what they say.
const server = createServer(
  { connectionsCheckingInterval: 1_000 },
  (req, res) => {
    handle(req, res).catch(() => {
      // Never log the error: it may hold the request body.
      log('error');
      if (!res.headersSent) reject(res, 500);
    });
  },
);
// Telegram sends small bodies quickly; slow senders are cut off.
server.headersTimeout = 5_000;
server.requestTimeout = 10_000;
server.maxConnections = 50;

server.listen(port, HOST, () => {
  console.log(`listening on http://${HOST}:${port}`);
});

const shutdown = () => {
  // Let in-flight requests finish before the pool goes away.
  server.close(() => void pool.end());
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
