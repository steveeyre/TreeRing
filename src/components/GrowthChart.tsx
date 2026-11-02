import { useMemo } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts'

export interface ChartPoint {
  /** Age in months, or epoch millis when plotting by date. */
  x: number
  label: string
  value: number | null
}

export interface ChartReference {
  age: number
  p3: number
  p50: number
  p97: number
}

export default function GrowthChart({
  data,
  unit,
  xMode,
  reference
}: {
  data: ChartPoint[]
  unit: string
  xMode: 'age' | 'date'
  reference?: ChartReference[]
}) {
  const rows = useMemo(() => {
    const map = new Map<number, Record<string, number>>()
    for (const r of reference ?? []) {
      map.set(r.age, { x: r.age, p3: r.p3, p50: r.p50, p97: r.p97 })
    }
    for (const d of data) {
      const cur = map.get(d.x) ?? { x: d.x }
      if (typeof d.value === 'number') cur.value = d.value
      map.set(d.x, cur)
    }
    return Array.from(map.values()).sort((a, b) => a.x - b.x)
  }, [data, reference])

  const values = data
    .map((d) => d.value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const min = values.length ? Math.min(...values) : null
  const max = values.length ? Math.max(...values) : null
  // A single reading makes dataMin === dataMax, which collapses the axis and pins the dot to
  // one edge. Pad flat series so the axis keeps a readable range around the value.
  const domain: [number, number] | ['auto', 'auto'] =
    min == null || max == null
      ? ['auto', 'auto']
      : min === max
        ? [
            Math.floor(min - Math.max(0.5, Math.abs(min) * 0.02)),
            Math.ceil(max + Math.max(0.5, Math.abs(min) * 0.02))
          ]
        : [Math.floor(min - (max - min) * 0.15), Math.ceil(max + (max - min) * 0.15)]

  const formatTick = (v: number): string => {
    if (xMode === 'date') {
      const d = new Date(v)
      return `${d.getMonth() + 1}/${d.getDate()}`
    }
    if (v < 12) return `${Math.round(v)}月`
    const years = v / 12
    return `${Number.isInteger(years) ? years : years.toFixed(1)}岁`
  }

  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ECE7DE" />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatTick}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={domain}
            unit={unit}
          />
          <Tooltip
            labelFormatter={(v) =>
              xMode === 'age' ? formatTick(Number(v)) : new Date(Number(v)).toLocaleDateString()
            }
          />
          {reference && (
            <>
              <Line
                dataKey="p3"
                name="参考下限 P3"
                stroke="#CFCCC0"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                dataKey="p97"
                name="参考上限 P97"
                stroke="#CFCCC0"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                dataKey="p50"
                name="参考中位 P50"
                stroke="#A9A79B"
                strokeWidth={1.2}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </>
          )}
          <Line
            type="monotone"
            dataKey="value"
            name={unit}
            stroke="#3F6B51"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
