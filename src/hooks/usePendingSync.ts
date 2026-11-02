import { useEffect, useState } from 'react'
import { pendingCount, subscribeOutbox } from '../lib/outbox'
import { flushOutbox } from '../lib/api'

/** Number of writes waiting for the network, plus a manual retry. */
export function usePendingSync() {
  const [count, setCount] = useState(() => pendingCount())
  useEffect(() => subscribeOutbox(() => setCount(pendingCount())), [])
  return {
    count,
    flush: () => {
      void flushOutbox()
    }
  }
}
