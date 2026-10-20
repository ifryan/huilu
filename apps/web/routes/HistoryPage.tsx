import { HistoryPage as SharedHistoryPage } from '@huilu/app-shell/routes/HistoryPage'
import { localResults } from '@/platform/storage'
export function HistoryPage() {
  return <SharedHistoryPage browserOnly={localResults} />
}
