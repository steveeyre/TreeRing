// Growth reference bands (WHO Child Growth Standards, 0–5 years).
// Values are the P3 / P50 / P97 at anchor ages, interpolated linearly in between.
// They are an observation aid for parents, not a diagnostic tool.

export type GrowthKind = 'height' | 'weight'
export type Sex = 'boy' | 'girl'

export interface RefPoint {
  age: number
  p3: number
  p50: number
  p97: number
}

type Anchor = [age: number, p3: number, p50: number, p97: number]

const HEIGHT: Record<Sex, Anchor[]> = {
  boy: [
    [0, 46.3, 49.9, 53.4],
    [6, 63.6, 67.6, 71.6],
    [12, 71.3, 75.7, 80.2],
    [18, 77.7, 82.3, 87.0],
    [24, 82.1, 87.1, 92.1],
    [36, 90.9, 96.1, 101.2],
    [48, 98.0, 103.3, 108.6],
    [60, 104.4, 110.0, 115.5]
  ],
  girl: [
    [0, 45.6, 49.1, 52.7],
    [6, 61.8, 65.7, 69.6],
    [12, 69.8, 74.0, 78.4],
    [18, 76.3, 80.7, 85.2],
    [24, 80.9, 85.7, 90.6],
    [36, 90.0, 95.1, 100.1],
    [48, 97.4, 102.7, 108.0],
    [60, 103.8, 109.4, 114.9]
  ]
}

const WEIGHT: Record<Sex, Anchor[]> = {
  boy: [
    [0, 2.5, 3.3, 4.3],
    [6, 6.4, 7.9, 9.8],
    [12, 7.8, 9.6, 11.8],
    [18, 8.8, 10.9, 13.4],
    [24, 9.7, 12.2, 15.1],
    [36, 11.3, 14.3, 17.8],
    [48, 12.7, 16.3, 20.5],
    [60, 14.1, 18.3, 23.2]
  ],
  girl: [
    [0, 2.4, 3.2, 4.2],
    [6, 5.8, 7.3, 9.2],
    [12, 7.1, 8.9, 11.1],
    [18, 8.2, 10.2, 12.6],
    [24, 9.0, 11.5, 14.4],
    [36, 10.8, 13.9, 17.5],
    [48, 12.3, 16.1, 20.4],
    [60, 13.7, 18.2, 23.3]
  ]
}

function interpolate(anchors: Anchor[], age: number): RefPoint {
  if (age <= anchors[0][0]) {
    const [, p3, p50, p97] = anchors[0]
    return { age, p3, p50, p97 }
  }
  const last = anchors[anchors.length - 1]
  if (age >= last[0]) {
    const [, p3, p50, p97] = last
    return { age, p3, p50, p97 }
  }
  for (let i = 1; i < anchors.length; i++) {
    const [a1, lo3, lo50, lo97] = anchors[i]
    if (age > a1) continue
    const [a0, hi3, hi50, hi97] = anchors[i - 1]
    const t = (age - a0) / (a1 - a0)
    return {
      age,
      p3: hi3 + (lo3 - hi3) * t,
      p50: hi50 + (lo50 - hi50) * t,
      p97: hi97 + (lo97 - hi97) * t
    }
  }
  const [, p3, p50, p97] = last
  return { age, p3, p50, p97 }
}

/** Reference points every 3 months from 0 up to `maxAge` (capped at 60). */
export function growthReference(kind: GrowthKind, sex: Sex, maxAge: number): RefPoint[] {
  const anchors = kind === 'height' ? HEIGHT[sex] : WEIGHT[sex]
  const top = Math.min(60, Math.max(6, Math.ceil(maxAge)))
  const out: RefPoint[] = []
  for (let age = 0; age <= top; age += 3) out.push(interpolate(anchors, age))
  if (out[out.length - 1].age !== top) out.push(interpolate(anchors, top))
  return out
}
