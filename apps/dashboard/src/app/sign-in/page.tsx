import { signIn } from '../actions';

export const dynamic = 'force-dynamic';

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="signin-art hidden flex-col items-center justify-center p-10 text-center lg:flex">
        <p className="text-sm tracking-[0.35em] text-[#d5e0ff]">
          YOUR MONEY, TALLIED
        </p>
        <p className="mt-3 text-5xl font-extrabold tracking-[0.12em]">HISAAB</p>
      </div>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <p className="mb-10 text-sm font-semibold tracking-[0.3em] lg:hidden">
            HISAAB
          </p>
          <h1 className="text-3xl font-bold">Welcome back</h1>
          <p className="mt-2 text-soft">Sign in to see your dashboard.</p>
          {/* Fixed text: the error parameter is never shown. */}
          {error !== undefined && (
            <p
              role="alert"
              className="mt-5 rounded-xl border border-warn/40 p-3 text-sm text-warn"
            >
              Sign-in failed.
            </p>
          )}
          <form action={signIn} className="mt-8">
            <button
              type="submit"
              className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 font-semibold text-[#14213d] transition-colors hover:bg-[#e6ecff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <GoogleMark />
              Sign in with Google
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
