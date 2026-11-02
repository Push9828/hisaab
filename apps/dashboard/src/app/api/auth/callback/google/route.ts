import { getAuth } from '../../../../../lib/auth';
import { requiredEnv } from '../../../../../lib/env';

// The only Better Auth URL exposed. Sign-in and sign-out go through server
// actions, so its other endpoints stay unreachable.
export async function GET(request: Request) {
  try {
    return await getAuth().handler(request);
  } catch {
    // Fixed text: Next would print the error, which can hold query parameters.
    console.error('dashboard: sign-in callback failed');
    return Response.redirect(
      new URL('/sign-in?error=1', requiredEnv('BETTER_AUTH_URL')),
      307,
    );
  }
}
