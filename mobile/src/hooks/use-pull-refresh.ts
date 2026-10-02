import { useCallback, useState } from 'react';

/**
 * Pull-to-refresh state that is true only while the person's own pull is
 * running — not during every background refetch, which would make the spinner
 * appear and vanish on its own.
 */
export function usePullRefresh(work: () => Promise<unknown>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void work()
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [work]);
  return { refreshing, onRefresh };
}
