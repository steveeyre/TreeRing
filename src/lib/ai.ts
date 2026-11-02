import { getAI } from './store'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number } = {}
): Promise<string> {
  const ai = getAI()
  if (!ai.apiKey) throw new Error('未配置 API Key（请在“设置”中填写）')
  const base = ai.baseUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ai.apiKey}`
    },
    body: JSON.stringify({
      model: ai.chatModel,
      messages,
      temperature: opts.temperature ?? 0.4,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {})
    })
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    throw new Error(`AI 请求失败 (${res.status})：${detail}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export function extractJson(text: string): unknown {
  const t = text.trim()
  try {
    return JSON.parse(t)
  } catch {
    /* fall through to bracket scan */
  }
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch {
      /* fall through */
    }
  }
  throw new Error('AI 返回内容不是有效 JSON')
}