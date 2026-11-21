import AuthScreen from '@/components/AuthScreen';
import WheelPathApp from '@/components/WheelPathApp';
import { getSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** the map is for signed-in people only; everyone else gets the sign-in / sign-up screen */
export default async function Page() {
  const session = await getSession();
  return session ? <WheelPathApp session={session} /> : <AuthScreen />;
}
