import {
  categoryRequest,
  reportRequest,
  type Categorizer,
  type ReportPicker,
} from '@hisaab/core';

const TIMEOUT_MS = 3_000;

/**
 * One request to Sarvam. Any failure rejects with no response text in it, and core
 * discards it. No retries: the owner is waiting for the reply.
 */
async function post(apiKey: string, request: unknown): Promise<unknown> {
  const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
    // fetch keeps this custom key header across origins on a redirect.
    redirect: 'error',
    // Also covers reading the body below.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`http-${String(response.status)}`);
  const body = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  return body.choices?.[0]?.message?.content;
}

export const sarvamCategorizer = (apiKey: string): Categorizer => ({
  ask: (text) => post(apiKey, categoryRequest(text)),
});

export const sarvamReportPicker = (apiKey: string): ReportPicker => ({
  pick: (text) => post(apiKey, reportRequest(text)),
});
