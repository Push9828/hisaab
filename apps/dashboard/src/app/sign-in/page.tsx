import { signIn } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>Hisaab</h1>
      {/* Fixed text: the error parameter is never shown. */}
      {error !== undefined && <p>Sign-in failed.</p>}
      <form action={signIn}>
        <button type="submit">Sign in with Google</button>
      </form>
    </main>
  );
}
