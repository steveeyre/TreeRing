export interface QuickTemplate {
  key: string
  label: string
  body: string
  categories?: string[]
}

/** One-tap skeletons to cut typing friction. */
export const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    key: 'quote',
    label: '💬 语录',
    body: '今天【情境】的时候，他说：「【原话】」',
    categories: ['quotes']
  },
  {
    key: 'newWord',
    label: '🗣 新词',
    body: '今天第一次说出「【词语】」，是在【情境】的时候。',
    categories: ['newWords']
  },
  {
    key: 'bedtime',
    label: '🌙 睡前',
    body: '今晚大约【时间】睡了。',
    categories: ['schedule']
  },
  {
    key: 'meal',
    label: '🥣 吃饭',
    body: '【早餐/午餐/晚餐】吃了【内容】。',
    categories: ['schedule', 'health']
  },
  {
    key: 'outdoor',
    label: '☀️ 外出',
    body: '去【地点】玩了大约【分钟】分钟，【备注】。',
    categories: ['schedule', 'development']
  },
  {
    key: 'book',
    label: '📚 绘本',
    body: '读了《【书名】》，【反应】。',
    categories: ['learning']
  },
  {
    key: 'illness',
    label: '🤒 不舒服',
    body: '孩子有点【症状】，【处理】。',
    categories: ['health']
  },
  {
    key: 'milestone',
    label: '🎉 高兴',
    body: '今天第一次【做了什么】，【心情】。',
    categories: ['development', 'event']
  }
]
