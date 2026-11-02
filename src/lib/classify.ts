import type { CategoryKey } from './types'

/**
 * Offline fallback classifier: parents record far more often than they configure an AI key,
 * so every entry gets a category and tags the moment it is saved. runParse overwrites the
 * ai_* fields with the model's answer once a key exists.
 */

const RULES: { key: CategoryKey; words: string[] }[] = [
  {
    key: 'quotes',
    words: ['语录', '原话', '他说', '她说', '宝宝说', '冒出一句', '说了一句']
  },
  {
    key: 'newWords',
    words: ['新词', '新词汇', '新学会说', '会说', '第一次说', '学会说']
  },
  {
    key: 'health',
    words: ['发烧', '发热', '咳嗽', '流鼻涕', '鼻塞', '感冒', '拉肚', '呕吐', '过敏', '疫苗', '打针',
      '接种', '医院', '看医生', '吃药', '喂药', '体温', '身高', '体重', '体检', '牙齿', '长牙', '湿疹',
      '疹子', '受伤', '磕', '摔', '流鼻血', '睡不好', '夜醒']
  },
  {
    key: 'event',
    words: ['生日', '周岁', '满月', '百日', '搬家', '入园', '上幼儿园', '上学', '旅行', '出游', '第一次',
      '纪念', '里程碑', '会走', '会说话']
  },
  {
    key: 'development',
    words: ['会了', '学会', '会自己', '能自己', '翻身', '会爬', '会站', '走路', '说词', '认人', '数数',
      '抓握', '自己坐', '长本事']
  },
  {
    key: 'learning',
    words: ['绘本', '读书', '讲故事', '识字', '字母', '拼音', '诗词', '背诵', '拼图', '画画', '手工',
      '上课', '学习', '英文', '英语', '颜色', '形状']
  },
  {
    key: 'habit',
    words: ['自己', '主动', '习惯', '坚持', '刷牙', '洗手', '收拾', '整理', '午睡', '作息', '吃饭',
      '不挑食', '规矩', '轮流', '分享', '排队', '穿衣服', '如厕', '戒奶']
  },
  {
    key: 'entertainment',
    words: ['动画', '电视', '游戏', '玩具', '娃娃', '唱歌', '跳舞', '游乐场', '乐园', '公园', '电影',
      '滑梯', '沙子', '乐高', '玩水', '摇摇车', '气球', '充值', '办卡', '礼物', '玩耍']
  },
  {
    key: 'schedule',
    words: ['预约', '安排', '计划', '行程', '接送', '接他', '接她', '送他', '送她', '幼儿园', '几点',
      '打卡', '按时', '出门', '遛弯', '散步']
  }
]

const TAG_RULES: [string, RegExp][] = [
  ['语录', /[「“"][^」”"]{2,}[」”"]|说(了|道|：|:)|原话/],
  ['新词', /会说|说出|新词|学会说|冒出新词/],
  ['绘本', /绘本|读故事|亲子阅读|故事书/],
  ['疫苗', /疫苗|打针|接种/],
  ['生病', /发烧|发热|感冒|咳嗽|拉肚|呕吐|过敏/],
  ['出门', /出门|公园|游乐场|散步|旅行|出游/],
  ['幼儿园', /幼儿园|入园|托班/],
  ['生日', /生日|周岁|蛋糕/],
  ['睡眠', /午睡|睡觉|作息|夜醒|入睡/]
]

export interface LocalClassification {
  categories: CategoryKey[]
  tags: string[]
}

export function classifyLocally(text: string): LocalClassification {
  const t = text.trim()
  if (!t) return { categories: [], tags: [] }
  const scored = RULES.map((r) => ({ key: r.key, score: r.words.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  // One entry belongs to exactly one category, so keep only the strongest match.
  const categories: CategoryKey[] = scored.length ? [scored[0].key] : ['other']
  const tags = TAG_RULES.filter(([, re]) => re.test(t)).map(([tag]) => tag)
  return { categories, tags }
}
