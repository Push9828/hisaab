import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { CATEGORY_PROMPT, reportRequest } from '@hisaab/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sarvamCategorizer, sarvamReportPicker } from './sarvam';

// Real HTTP against a local server, because the timeout and the redirect rule are
// fetch's behaviour. Only the URL is swapped. The key is fake.
const KEY = 'fake-sarvam-key';
const realFetch = globalThis.fetch;
let server: Server | undefined;

async function serve(
  handler: Parameters<typeof createServer>[1],
): Promise<void> {
  const local = createServer(handler);
  server = local;
  await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
  const { port } = local.address() as AddressInfo;
  vi.stubGlobal('fetch', (path: string, init: RequestInit) =>
    realFetch(
      `http://127.0.0.1:${String(port)}${new URL(path).pathname}`,
      init,
    ),
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
  server = undefined;
});

const OK_BODY = JSON.stringify({
  choices: [{ message: { content: '{"category":"Food"}' } }],
});

describe('sarvamReportPicker', () => {
  it('sends the question under the report schema, with the key only in the header', async () => {
    let seen: { key: unknown; body: string } | undefined;
    await serve((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen = { key: req.headers['api-subscription-key'], body };
        res.end(OK_BODY);
      });
    });
    await sarvamReportPicker(KEY).pick('food last month');
    expect(seen?.key).toBe(KEY);
    expect(seen?.body).not.toContain(KEY);
    expect(JSON.parse(seen?.body ?? '')).toEqual(
      JSON.parse(JSON.stringify(reportRequest('food last month'))),
    );
  });

  it('shares the redirect and timeout rules', async () => {
    await serve((_, res) => {
      res.statusCode = 302;
      res.setHeader('location', '/elsewhere');
      res.end();
    });
    await expect(sarvamReportPicker(KEY).pick('food')).rejects.toThrow();
  });
});

describe('sarvamCategorizer', () => {
  it('sends the text with the key, the prompt and the fixed options', async () => {
    let seen: { url?: string; key: unknown; body: string } | undefined;
    await serve((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen = { url: req.url, key: req.headers['api-subscription-key'], body };
        res.end(OK_BODY);
      });
    });

    expect(await sarvamCategorizer(KEY).ask('masala dosa')).toBe(
      '{"category":"Food"}',
    );

    expect(seen?.url).toBe('/v1/chat/completions');
    expect(seen?.key).toBe(KEY);
    const sent = JSON.parse(seen?.body ?? '') as Record<string, never>;
    expect(sent).toMatchObject({
      model: 'sarvam-105b',
      temperature: 0,
      reasoning_effort: null,
    });
    const { messages, response_format } = sent as unknown as {
      messages: { role: string; content: string }[];
      response_format: {
        json_schema: {
          schema: { properties: { category: { enum: string[] } } };
        };
      };
    };
    expect(messages[0]).toEqual({ role: 'system', content: CATEGORY_PROMPT });
    expect(messages[1]).toEqual({ role: 'user', content: 'masala dosa' });
    const options = response_format.json_schema.schema.properties.category.enum;
    expect(options).toContain('unsure');
    expect(options).not.toContain('Salary');
  });

  it('rejects on an error status, without echoing the response', async () => {
    await serve((_, res) => {
      res.statusCode = 429;
      res.end('too many requests for fake-sarvam-key');
    });
    const failure = sarvamCategorizer(KEY).ask('chai');
    await expect(failure).rejects.toThrow('http-429');
    await expect(failure).rejects.not.toThrow(KEY);
  });

  it('refuses a redirect, which would carry the key to another origin', async () => {
    let followed = false;
    await serve((req, res) => {
      if (req.url === '/elsewhere') followed = true;
      res.statusCode = 302;
      res.setHeader('location', '/elsewhere');
      res.end();
    });
    await expect(sarvamCategorizer(KEY).ask('chai')).rejects.toThrow();
    expect(followed).toBe(false);
  });

  it('rejects by the timeout when the server never answers', async () => {
    await serve(() => undefined);
    const started = Date.now();
    await expect(sarvamCategorizer(KEY).ask('chai')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 6_000);

  it('rejects by the timeout when the body stalls after the headers', async () => {
    await serve((_, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"choices":');
    });
    const started = Date.now();
    await expect(sarvamCategorizer(KEY).ask('chai')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 6_000);

  it('returns undefined content when the body has no answer', async () => {
    await serve((_, res) => res.end('{}'));
    expect(await sarvamCategorizer(KEY).ask('chai')).toBeUndefined();
  });
});
