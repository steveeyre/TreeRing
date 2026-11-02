import { useAppStore, usePrefs } from '../lib/store'

export default function RecorderSwitcher({ compact = false }: { compact?: boolean }) {
  const members = useAppStore((s) => s.members)
  const recorderId = usePrefs((s) => s.currentRecorderId)
  const setRecorderId = usePrefs((s) => s.setCurrentRecorderId)
  const current = members.find((m) => m.id === recorderId)

  return (
    <div className="inline-flex items-center rounded-full border border-line bg-white p-1">
      <span className="px-2 text-xs text-muted">记录人</span>
      {members.map((m) => {
        const active = m.id === recorderId
        return (
          <button
            key={m.id}
            aria-label={m.name}
            className={`flex items-center justify-center gap-1 rounded-full font-medium transition-colors ${
              compact ? 'h-9 w-11' : 'h-9 px-3 text-sm'
            } touch-target ${active ? 'bg-ink text-white' : 'text-muted'}`}
            onClick={() => setRecorderId(m.id)}
          >
            <span>{m.emoji}</span>
            {!compact && <span>{m.name}</span>}
          </button>
        )
      })}
      {!current && members.length === 0 && <span className="px-2 text-sm text-muted">待添加</span>}
    </div>
  )
}