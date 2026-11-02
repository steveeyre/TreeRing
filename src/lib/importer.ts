export interface MilestoneImport {
  title: string
  description?: string | null
  age_min_months?: number | null
  age_max_months?: number | null
  category?: string | null
  status?: 'todo' | 'done'
}

const TITLE_KEYS = ['title', 'name', '事项', '名称', '内容', '项目', '任务', 'item', '印记']
const DESC_KEYS = ['description', 'desc', '描述', '备注', '说明', 'note', '详情', '备注说明']
const AGE_KEYS = ['age', '适宜年龄', '年龄', '适合年龄']
const AGE_MIN_KEYS = ['age_min_months', 'age_min', '最小年龄', '下限', '起始年龄', 'age_min_month']
const AGE_MAX_KEYS = ['age_max_months', 'age_max', '最大年龄', '上限', 'age_max_month']
const CAT_KEYS = ['category', '分类', '类别', '小类', 'type', '类型', '主题']
const STATUS_KEYS = ['status', '状态', '是否完成']

function pick(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  // fuzzy: any key containing one of the keys
  for (const k of Object.keys(row)) {
    const lk = k.toLowerCase()
    if (keys.some((key) => lk === key.toLowerCase() || lk.includes(key.toLowerCase()))) {
      const v = row[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    }
  }
  return undefined
}

/** 解析“36个月 / 3岁+ / 3-6岁 / 36-72个月”等年龄写法 → [minMonths, maxMonths] */
export function parseAgeRange(text: string): [number | null, number | null] {
  const s = text.replace(/[（(【\[]/g, ' ').replace(/[）)】\]]/g, ' ').trim()
  const monthMatch = s.match(/(\d+)\s*[-~到至]\s*(\d+)\s*个月?/)
  if (monthMatch) return [Number(monthMatch[1]), Number(monthMatch[2])]
  const yearRange = s.match(/(\d+)\s*[-~到至]\s*(\d+)\s*岁/)
  if (yearRange) return [Number(yearRange[1]) * 12, Number(yearRange[2]) * 12]
  const monthPlus = s.match(/(\d+)\s*个月?(?:\s*(?:以上|\+|及)?|$)/)
  if (monthPlus && s.includes('个月')) return [Number(monthPlus[1]), null]
  const yearPlus = s.match(/(\d+)\s*岁(?:\s*(?:以上|\+|及))?/)
  if (yearPlus) {
    const plus = /岁\s*(以上|\+|及)/.test(s)
    return [Number(yearPlus[1]) * 12, plus ? null : null]
  }
  const bare = s.match(/^(\d+)$/)
  if (bare) return [Number(bare[1]), null]
  return [null, null]
}

interface RowOptions {
  /** 表头只写「适宜年龄」、单元格是裸数字时按岁换算（footprints.md 的 4 指 4 岁）。 */
  bareAgeInYears?: boolean
}

function fromRow(row: Record<string, unknown>, opts: RowOptions = {}): MilestoneImport | null {
  const title = pick(row, TITLE_KEYS)
  if (!title) return null
  const item: MilestoneImport = { title }
  const desc = pick(row, DESC_KEYS)
  if (desc) item.description = desc
  const cat = pick(row, CAT_KEYS)
  if (cat) item.category = cat
  let min: number | null = null
  let max: number | null = null
  const ageMinRaw = pick(row, AGE_MIN_KEYS)
  const ageMaxRaw = pick(row, AGE_MAX_KEYS)
  if (ageMinRaw) min = Number(ageMinRaw) || null
  if (ageMaxRaw) max = Number(ageMaxRaw) || null
  const ageRaw = pick(row, AGE_KEYS)
  if (ageRaw) {
    const [a, b] = parseAgeRange(ageRaw)
    if (a !== null) min = a
    if (b !== null) max = b
    const bare = Number(ageRaw)
    if (opts.bareAgeInYears && /^\d{1,2}$/.test(ageRaw) && bare <= 18) min = bare * 12
  }
  if (min !== null) item.age_min_months = min
  if (max !== null) item.age_max_months = max
  const st = pick(row, STATUS_KEYS)
  if (st && /完成|done|✓|✅|1|true/i.test(st)) item.status = 'done'
  return item
}

/* ---------------- JSON ---------------- */

function fromJson(text: string): MilestoneImport[] {
  const data = JSON.parse(text)
  const arr = Array.isArray(data) ? data : Array.isArray(data?.milestones) ? data.milestones : []
  return arr.map((r: unknown) => fromRow(r as Record<string, unknown>)).filter(
    (x: MilestoneImport | null): x is MilestoneImport => !!x
  )
}

/* ---------------- CSV ---------------- */

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',' || ch === '\t') {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function fromCsv(text: string): MilestoneImport[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const headers = splitCsvLine(lines[0]).map((h) => h.replace(/^#/, ''))
  const items: MilestoneImport[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const row: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? ''
    })
    const item = fromRow(row)
    if (item) items.push(item)
  }
  return items
}

/* ---------------- Markdown ---------------- */

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function isTableDivider(line: string): boolean {
  const t = line.trim()
  return t.includes('-') && /^\|?[\s:|-]+\|?$/.test(t)
}

function fromTableBlock(
  headerLine: string,
  rowLines: string[],
  fallbackCategory: string | null
): MilestoneImport[] {
  const headers = splitTableRow(headerLine)
  const ageHeader = headers.find((h) =>
    AGE_KEYS.some((k) => h.toLowerCase().includes(k.toLowerCase()))
  )
  // 表头写「适宜年龄」时裸数字按岁算，写了「月」才按月。
  const bareAgeInYears = !ageHeader || !ageHeader.includes('月')
  const items: MilestoneImport[] = []
  for (const line of rowLines) {
    const cells = splitTableRow(line)
    if (headers.every((h, idx) => h === (cells[idx] ?? ''))) continue
    const row: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      if (h) row[h] = cells[idx] ?? ''
    })
    const item = fromRow(row, { bareAgeInYears })
    if (!item) continue
    if (!item.category && fallbackCategory) item.category = fallbackCategory
    items.push(item)
  }
  return items
}

function fromMarkdown(text: string): MilestoneImport[] {
  const items: MilestoneImport[] = []
  let category: string | null = null
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) {
      i++
      continue
    }
    // markdown 表格：表头 + 分隔行 + 连续数据行（footprints.md 即此结构）
    if (line.startsWith('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const rowLines: string[] = []
      let j = i + 2
      while (j < lines.length) {
        const t = lines[j].trim()
        if (!t || !t.startsWith('|') || isTableDivider(t)) break
        rowLines.push(t)
        j++
      }
      items.push(...fromTableBlock(line, rowLines, category))
      i = j
      continue
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (heading) {
      category = heading[1].trim() || null
      i++
      continue
    }
    const li = line.match(/^[-*•]\s*(?:\[( |x|X)\]\s*)?(.*)$/)
    if (!li) {
      i++
      continue
    }
    const content = li[2].trim()
    if (!content) {
      i++
      continue
    }
    const item: MilestoneImport = { title: content }
    if (category) item.category = category
    if (li[1] && /[xX]/.test(li[1])) item.status = 'done'
    // 描述：标题：描述 / 标题——描述 / 标题（描述）
    const m = content.match(/^(.+?)[：:]\s*(.+)$/)
    if (m && m[2].length >= 4) {
      item.title = m[1].trim()
      item.description = m[2].trim()
    } else {
      const d = content.match(/^(.+?)(?:——|--)\s*(.+)$/)
      if (d && d[2].length >= 4) {
        item.title = d[1].trim()
        item.description = d[2].trim()
      }
    }
    const [min, max] = parseAgeRange(item.title)
    if (min !== null) {
      item.age_min_months = min
      item.title = item.title.replace(/[（(【\[]\s*[\d\-~到至岁个月以上+及\s]*[）)】\]]/g, '').replace(/\s*[\d\-~到至岁个月以上+及\s]+$/, '').trim()
    }
    if (max !== null) item.age_max_months = max
    items.push(item)
    i++
  }
  return items
}

/* ---------------- xlsx ---------------- */

async function fromXlsx(file: File): Promise<MilestoneImport[]> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  if (!rows.length) return []
  // 若第一行整行都是表头关键词，则视为表头（sheet_to_json 默认已用表头）
  const items = rows.map((r) => fromRow(r)).filter((x): x is MilestoneImport => !!x)
  return items
}

/** 直接解析一段文本（内置清单不走 File）。 */
export function parseMilestonesText(text: string, name: string): MilestoneImport[] {
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) return fromJson(text)
  if (lower.endsWith('.csv')) return fromCsv(text)
  return fromMarkdown(text)
}

export async function parseMilestonesFile(file: File): Promise<MilestoneImport[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return fromXlsx(file)
  if (!/\.(json|csv|md|markdown|txt)$/.test(name)) {
    throw new Error('不支持的格式，请用 .xlsx / .csv / .json / .md 文件')
  }
  return parseMilestonesText(await file.text(), name)
}
