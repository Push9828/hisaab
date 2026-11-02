import { signOut } from './actions';
import { requireOwner } from '../lib/owner';

export const dynamic = 'force-dynamic';

export default async function Home() {
  await requireOwner();
  return (
    <main>
      <h1>Hisaab</h1>
      <form action={signOut}>
        <button type="submit">Sign out everywhere</button>
      </form>
    </main>
  );
}
