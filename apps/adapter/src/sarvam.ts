import { categoryRequest, type Categorizer } from '@hisaab/core';

const TIMEOUT_MS = 3_000;

/**
 * Asks Sarvam for a category. Any failure rejects with no response text in it,
 * and core discards it. No retries: the owner is waiting for the reply.
 */
export const sarvamCategorizer = (apiKey: string): Categorizer => ({
  ask: async (text) => {
    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(categoryRequest(text)),
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
  },
});
