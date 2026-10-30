import {
  handleWebhook,
  hasValidSecret,
  type LogLabel,
  type WebhookDeps,
} from './telegram';

/**
 * API Gateway HTTP API (payload format 2.0) in front of `handleWebhook`.
 * Pure: the Lambda entry point (`lambda.ts`) supplies the store and config.
 */

/** Same cap as `local.ts`. Telegram updates are a few KB. */
export const MAX_BODY_BYTES = 64 * 1024;

export type HttpLogLabel = LogLabel | 'bad_request';

/** The fields we read from the event. v2 lowercases header names and comma-joins repeats. */
export interface HttpApiEvent {
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface HttpApiResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpApiDeps extends Omit<WebhookDeps, 'log'> {
  log: (label: HttpLogLabel) => void;
}

export async function handleHttpApi(
  event: HttpApiEvent,
  deps: HttpApiDeps,
): Promise<HttpApiResult> {
  const headers = event.headers ?? {};
  // Checked again in handleWebhook; here it stops strangers before we decode a byte.
  if (!hasValidSecret(headers, deps.config.secret)) {
    deps.log('unauthorized');
    return { statusCode: 401 };
  }

  const raw = Buffer.from(
    event.body ?? '',
    event.isBase64Encoded ? 'base64' : 'utf8',
  );
  if (raw.length > MAX_BODY_BYTES) {
    deps.log('bad_request');
    return { statusCode: 413 };
  }

  const { status, body } = await handleWebhook(
    { headers, body: raw.toString('utf8') },
    deps,
  );
  return body === undefined
    ? { statusCode: status }
    : {
        statusCode: status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      };
}
