export interface DayStat {
  label: string
  min: number
}

export default function StatBlock({
  title,
  value,
  sub,
  days
}: {
  title: string
  value: string
  sub?: string
  days?: DayStat[]
}) {
  const max = Math.max(1, ...(days ?? []).map((d) => d.min))
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-muted">{title}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      {days && (
        <div className="flex items-end gap-1 h-20">
          {days.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-sm bg-brand/70"
                style={{
                  height: `${(d.min / max) * 100}%`,
                  minHeight: d.min ? 4 : 2
                }}
              />
              <span className="text-[9px] text-muted">{d.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}