import { chatCompletion } from './ai'

const SYSTEM_PROMPT = `你是一位资深的正面管教（Positive Discipline）育儿顾问，擅长温和而坚定地处理 0-12 岁孩子的日常挑战。

要求：
- 用中文回答，语气温和、坚定、可执行
- 先共情孩子和家长，再给出 2-4 条具体、可操作的建议
- 融入正面管教理念：联结先于纠正、鼓励而非表扬、让孩子参与解决问题、和善与坚定并行
- 避免说教、评判、威胁或体罚
- 全文控制在 250 字以内`

export async function requestAdviceText(body: string, context: string): Promise<string> {
  return chatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `孩子情况：${context}\n记录内容：\n${body}\n\n请针对这条记录给出育儿建议。` }
    ],
    { temperature: 0.5 }
  )
}