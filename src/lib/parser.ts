import { chatCompletion, extractJson } from './ai'
import type { CategoryKey, ParsedResult } from './types'

const SYSTEM_PROMPT = `你是「小年轮」育儿记录助手。用户用自然语言记录孩子成长的片段，你需要把它拆解为结构化数据。

只输出一个 JSON 对象，不要输出任何其他内容、注释或 Markdown。JSON 结构：

{
  "categories": ["schedule", "health", "habit", "development", "learning", "entertainment", "event", "quotes", "newWords", "parent", "other"],
  "tags": ["简短标签"],
  "facts": {
    "summary": "一句话摘要",
    "sleep": { "start": "HH:mm", "end": "HH:mm", "durationMin": 90, "bedtimeStory": "睡前故事名", "comfortToy": "陪睡玩偶名" },
    "meals": [{ "type": "早餐|午餐|晚餐|加餐", "time": "HH:mm", "content": "吃了什么" }],
    "outdoor": { "type": "户外活动类型", "durationMin": 60 },
    "growth": { "heightCm": 95, "weightKg": 14.2 },
    "waterMl": 300,
    "teeth": "牙齿情况描述",
    "books": [{ "title": "书名", "author": "作者" }],
    "games": [{ "title": "游戏名", "platform": "平台" }],
    "media": [{ "title": "片名", "kind": "动画|电影|纪录片" }],
    "newWords": ["新学会的词语"],
    "quotes": ["孩子说的话"],
    "milestones": [{ "title": "完成的有意义的事" }],
    "illness": { "name": "病名", "onset": "发病时间", "symptoms": "症状", "medication": "用药情况", "recovery": "康复过程" }
  }
}

规则：
- categories 只给 1 个最贴合的分类，绝对不要给多个；"日程"指作息、吃饭、睡眠、户外时长；"健康"指身高体重、饮水、饮食、牙齿、疫苗、疾病过敏；"习惯"指运动、如厕、规则执行；"能力发展"指动作、社交等能力进步；"语录"指孩子说出的原话、金句；"新词"指孩子新学会的词语；"学习"指童书、动画电影、桌游电子游戏；"玩乐"指休闲游乐、玩具、娃娃、充值办卡等消费型的玩；"大事记"指过节、生日、旅行、完成清单事项；"家长专区"只限于家长自己的育儿困惑、体会与反思、读的育儿书摘录
- 带孩子玩、给孩子买玩具或充值都归"玩乐"；"家长专区"不要收这类内容
- 时间统一为 "HH:mm"，无法确定就省略
- 无法从正文推出的字段不要出现在 JSON 中
- tags 用 3-6 个简短的中文标签，例如 "睡眠"、"户外"、"疫苗"`

// Semantic categories first: "第一次说新词" should land in 新词/语录, not 能力发展.
const LOCAL_RULES: { key: CategoryKey; words: string[] }[] = [
  { key: 'quotes', words: ['语录', '原话', '他说', '她说', '宝宝说', '说了一句'] },
  { key: 'newWords', words: ['新词', '新词汇', '第一次说', '学会说', '会说'] },
  { key: 'event', words: ['生日', '过节', '春节', '中秋', '国庆', '儿童节', '圣诞', '元旦', '旅行', '出游', '旅游', '第一次去', '聚会', '婚礼', '搬家', '入园', '入学', '毕业'] },
  { key: 'health', words: ['身高', '体重', '体温', '发烧', '咳嗽', '流鼻涕', '感冒', '生病', '吃药', '疫苗', '打针', '接种', '过敏', '体检', '牙齿', '喝水', '饮水', '拉肚子', '湿疹', '医院'] },
  { key: 'schedule', words: ['睡觉', '午睡', '起床', '早餐', '午餐', '晚餐', '加餐', '吃饭', '吃了', '喝奶', '奶粉', '辅食', '户外', '散步', '公园', '作息', '洗澡'] },
  { key: 'learning', words: ['绘本', '看书', '读书', '故事', '识字', '拼音', '英语', '单词', '桌游', '拼图', '积木', '动画', '电影', '纪录片', '儿歌', '画画', '涂色'] },
  { key: 'development', words: ['新词', '会说', '说了', '第一次说', '语录', '会走', '会跑', '会跳', '会爬', '学会', '认识', '发音', '句子', '叫妈妈', '叫爸爸'] },
  { key: 'habit', words: ['如厕', '马桶', '拉臭', '穿衣', '收玩具', '整理', '规则', '习惯', '洗手', '刷牙', '自主'] },
  { key: 'entertainment', words: ['玩具', '娃娃', '游乐场', '乐园', '玩', '玩耍', '溜达', '滑梯', '秋千', '沙池', '戏水', '捉迷藏', '充值', '办卡', '买了', '礼物'] },
  { key: 'parent', words: ['反思', '困惑', '焦虑', '纠结', '育儿书', '摘录', '心得', '体会', '育儿理念'] }
]

/**
 * Keyword fallback classifier. Runs when the model is unavailable or returns nothing
 * usable, so an entry never lands without a category.
 */
export function classifyLocally(body: string): CategoryKey[] {
  const text = body ?? ''
  if (!text.trim()) return ['other']
  const scored = LOCAL_RULES.map(({ key, words }) => ({
    key,
    score: words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0)
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.length ? [scored[0].key] : ['other']
}

export function childContextText(name: string | null, ageMonths: number | null): string {
  return `${name ? `孩子名字：${name}。` : ''}${ageMonths != null ? `当前月龄：约 ${ageMonths} 个月。` : ''}记录日期：${new Date().toLocaleDateString('zh-CN')}。`
}

export async function parseEntryText(body: string, context: string): Promise<ParsedResult> {
  const content = await chatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `孩子情况：${context}\n记录正文：\n${body}` }
    ],
    { json: true, temperature: 0.2 }
  )
  const raw = extractJson(content) as Partial<ParsedResult>
  return normalize(raw)
}

function normalize(r: Partial<ParsedResult>): ParsedResult {
  const valid: CategoryKey[] = [
    'schedule',
    'health',
    'habit',
    'development',
    'learning',
    'entertainment',
    'event',
    'quotes',
    'newWords',
    'parent',
    'other'
  ]
  const categories = (Array.isArray(r.categories) ? r.categories : []).filter(
    (c): c is CategoryKey => valid.includes(c as CategoryKey)
  )
  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === 'string').slice(0, 10)
    : []
  const facts = r.facts && typeof r.facts === 'object' ? r.facts : {}
  return { categories: categories.length ? [categories[0]] : ['other'], tags, facts }
}