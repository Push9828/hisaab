import { getAuth } from '../../../../../lib/auth';

// The only Better Auth URL exposed. Sign-in and sign-out go through server
// actions, so its other endpoints stay unreachable.
export const GET = (request: Request) => getAuth().handler(request);
