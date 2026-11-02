// Dependency-free test suite: esbuild bundles the pure modules, node:test runs them.
// Run with `npm test`.

import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const outDir = 'node_modules/.cache/mengya-tests'
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: {
    classify: 'src/lib/classify.ts',
    format: 'src/lib/format.ts',
    outbox: 'src/lib/outbox.ts',
    growthRef: 'src/lib/growthRef.ts'
  },
  outdir: outDir,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'node20',
  logLevel: 'error'
})

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
}

const load = (name) =>
  import(pathToFileURL(`${process.cwd()}/${outDir}/${name}.js`).href)

const classify = await load('classify')
const format = await load('format')
const outbox = await load('outbox')
const growthRef = await load('growthRef')

test('分类：语录原话优先于问候/习惯词', () => {
  const r = classify.classifyLocally('他说：「月亮跟着我走」')
  assert.deepEqual(r.categories, ['quotes'])
  assert.ok(r.tags.includes('语录'))
})

test('分类：健康关键词与标签', () => {
  const r = classify.classifyLocally('今天打了疫苗，没有发烧')
  assert.deepEqual(r.categories, ['health'])
  assert.ok(r.tags.includes('疫苗'))
})

test('分类：绘本归到学习', () => {
  const r = classify.classifyLocally('读了一本绘本')
  assert.deepEqual(r.categories, ['learning'])
  assert.ok(r.tags.includes('绘本'))
})

test('分类：空文本不臆造分类', () => {
  assert.deepEqual(classify.classifyLocally('   '), { categories: [], tags: [] })
})

test('格式化：时长与月龄', () => {
  assert.equal(format.fmtDuration(45), '45 分钟')
  assert.equal(format.fmtDuration(90), '1 小时 30 分')
  assert.equal(format.ageInMonths('2024-01-15', new Date(2025, 2, 14)), 13)
  assert.equal(format.ageInMonths(null), null)
})

test('生长参考：插值单调且 P3 < P50 < P97', () => {
  const ref = growthRef.growthReference('height', 'boy', 12)
  assert.equal(ref[0].p50, 49.9)
  assert.equal(ref[ref.length - 1].age, 12)
  assert.equal(ref[ref.length - 1].p50, 75.7)
  for (const p of ref) assert.ok(p.p3 < p.p50 && p.p50 < p.p97)
})

test('离线队列：保存 + 补丁 + 删除', () => {
  const base = { userId: 'u1', table: 'entries', createdAt: 't' }
  outbox.enqueueMutation({
    ...base,
    id: '1',
    kind: 'save',
    row: { id: 'e1', body: 'a', occurred_at: '2026-01-01T00:00:00Z' }
  })
  outbox.enqueueMutation({ ...base, id: '2', kind: 'update', rowId: 'e1', patch: { body: 'b' } })

  assert.equal(outbox.pendingCount(), 2)
  const pending = outbox.pendingEntries()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].body, 'b')
  assert.ok(pending[0].created_at)

  outbox.enqueueMutation({
    ...base,
    id: '3',
    kind: 'update',
    rowId: 'e1',
    patch: { deleted_at: '2026-01-02T00:00:00Z' }
  })
  assert.equal(outbox.pendingEntries().length, 0)

  outbox.removeMutation('3')
  assert.equal(outbox.pendingEntries().length, 1)
  outbox.clearOutbox()
  assert.equal(outbox.pendingCount(), 0)
})
