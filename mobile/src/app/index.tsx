import { Redirect } from 'expo-router';

import { Loading } from '@/components/ui';
import { useSession } from '@/lib/session';

/** First stop: the projects if this phone is paired, otherwise pairing. */
export default function Index() {
  const session = useSession();
  if (session.status === 'loading') return <Loading />;
  return <Redirect href={session.status === 'paired' ? '/projects' : '/pair'} />;
}
