import { useRef, useState } from 'react'
import { toBlob } from 'html-to-image'
import Modal from './Modal'
import { CATEGORY_MAP } from '../lib/constants'
import { fmtDateTime } from '../lib/format'
import { usePrefs } from '../lib/store'
import type { Child, Entry, Member } from '../lib/types'

const PALETTE = {
  paper: '#EFF1EA',
  ink: '#26302A',
  muted: '#6F7568',
  faint: '#B9BFB2',
  card: '#FFFFFF',
  line: '#D6D3C6',
  tagBg: '#E7EBE1',
  tagInk: '#4E5A50'
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const SANS = "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

// Authored at 1080x1440 so the exported PNG stays crisp; the preview is scaled to fit the sheet.
const CARD_W = 1080
const CARD_H = 1440
const PREVIEW_W = 300
// The poster frame is fixed, so the body must never outgrow it: cap the text and step
// the type size down as it gets longer.
const MAX_BODY_CHARS = 420

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (
    !!window.matchMedia?.('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|iPod|MicroMessenger/i.test(navigator.userAgent)
  )
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export default function SocialCard({
  entry,
  member,
  child,
  open,
  onClose
}: {
  entry: Entry
  member?: Member | null
  child?: Child | null
  open: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  // WeChat's in-app browser supports neither Web Share nor clipboard images, so the card is
  // also rendered as a plain <img> there for long-press saving.
  const [fallbackSrc, setFallbackSrc] = useState('')
  const hideShareName = usePrefs((s) => s.hideShareName)
  const childLabel = hideShareName ? '宝贝' : (child?.name ?? '宝贝')
  // An entry carries one primary category; extra ones would only dilute the poster.
  const meta = CATEGORY_MAP[entry.categories[0]] ?? CATEGORY_MAP.other
  const scale = PREVIEW_W / CARD_W

  const d = new Date(entry.created_at)
  const dateText = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`

  const body = entry.body.trim()
  const bodyText = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS).trimEnd()}…` : body
  const longBody = body.length > 160
  const bodyFont = body.length > 300 ? 34 : body.length > 200 ? 40 : body.length > 120 ? 48 : body.length > 60 ? 56 : 62

  const fileName = () => `小年轮-${fmtDateTime(entry.created_at).replace(/[:\s]/g, '-')}.png`

  const renderBlob = async (): Promise<Blob | null> => {
    if (!ref.current) return null
    return toBlob(ref.current, { pixelRatio: 2, backgroundColor: PALETTE.paper })
  }

  const download = (blob: Blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName()
    a.click()
    URL.revokeObjectURL(url)
  }

  const savePng = async () => {
    setBusy(true)
    setHint('')
    try {
      const blob = await renderBlob()
      if (blob) download(blob)
    } finally {
      setBusy(false)
    }
  }

  const shareToWeChat = async () => {
    setBusy(true)
    setHint('')
    setFallbackSrc('')
    try {
      const blob = await renderBlob()
      if (!blob) return
      const file = new File([blob], fileName(), { type: 'image/png' })
      // Phones: the system share sheet lists WeChat and takes the file directly. Safari can
      // reject share() once the async render has consumed the gesture, so never rely on it.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
          return
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return
        }
      }
      // Phones do not expose image clipboard writes to other apps, and a copy that silently
      // lands nowhere is worse than none — show the PNG so it can be long-pressed into the album.
      if (isTouchDevice()) {
        setFallbackSrc(await blobToDataUrl(blob))
        setHint('长按上方图片保存到相册，再到微信里发送')
        return
      }
      // Desktop: paste straight into the WeChat chat window.
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setHint('图片已复制，切到微信窗口粘贴即可发送')
      } catch {
        download(blob)
        setHint('浏览器不支持直接发送，已改为保存图片')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="分享卡片">
      <div className="flex flex-col items-center gap-4">
        <div style={{ width: PREVIEW_W, height: CARD_H * scale, overflow: 'hidden', margin: '0 auto' }}>
          <div style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <div
              ref={ref}
              style={{
                width: CARD_W,
                height: CARD_H,
                padding: 44,
                boxSizing: 'border-box',
                background: 'linear-gradient(155deg, #FDFBF7 0%, #F3EDE1 100%)',
                fontFamily: SANS
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 60,
                  borderRadius: 48,
                  background: PALETTE.card,
                  border: `1px solid ${PALETTE.line}`,
                  boxShadow: '0 28px 70px rgba(27, 27, 27, 0.08)'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexShrink: 0
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                    <span
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        background: '#E7EBE1',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 30
                      }}
                    >
                      <svg width={32} height={32} viewBox="0 0 48 48" fill="none">
                        <circle cx="24" cy="24" r="2.6" fill="#3F6B51" />
                        <circle cx="24" cy="24" r="8.5" stroke="#3F6B51" strokeWidth="1.7" />
                        <circle cx="24" cy="24" r="14.5" stroke="#3F6B51" strokeWidth="1.4" opacity="0.65" />
                        <circle cx="24" cy="24" r="20.5" stroke="#3F6B51" strokeWidth="1.2" opacity="0.4" strokeDasharray="58 5" />
                      </svg>
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 26,
                        letterSpacing: 6,
                        color: PALETTE.muted
                      }}
                    >
                      TREERING
                    </span>
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 26, letterSpacing: 2, color: PALETTE.muted }}>
                    {dateText}
                  </span>
                </div>

                <div
                  style={{
                    width: 120,
                    height: 12,
                    borderRadius: 999,
                    background: PALETTE.ink,
                    marginTop: 48,
                    flexShrink: 0
                  }}
                />

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 20,
                    marginTop: 36,
                    flexShrink: 0
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 30px',
                      borderRadius: 999,
                      fontSize: 30,
                      fontWeight: 700,
                      color: meta.color,
                      background: `${meta.color}14`
                    }}
                  >
                    {meta.emoji} {meta.label}
                  </span>
                  {member && (
                    <span style={{ fontSize: 26, color: PALETTE.muted }}>
                      {member.emoji} {member.name} 记录
                    </span>
                  )}
                </div>

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: longBody ? 'flex-start' : 'center',
                    padding: '40px 0 32px',
                    overflow: 'hidden'
                  }}
                >
                  <span
                    style={{
                      fontSize: bodyFont,
                      lineHeight: 1.6,
                      fontWeight: 700,
                      letterSpacing: 1,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                  >
                    {bodyText}
                  </span>
                </div>

                {entry.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, flexShrink: 0 }}>
                    {entry.tags.slice(0, 6).map((t) => (
                      <span
                        key={t}
                        style={{
                          padding: '10px 24px',
                          borderRadius: 999,
                          background: PALETTE.tagBg,
                          color: PALETTE.tagInk,
                          fontFamily: MONO,
                          fontSize: 24,
                          wordBreak: 'break-all'
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ height: 2, background: PALETTE.line, margin: '38px 0 32px', flexShrink: 0 }} />

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexShrink: 0
                  }}
                >
                  <span style={{ fontSize: 30, fontWeight: 700, color: PALETTE.ink }}>
                    {childLabel} 的成长手账
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 24, letterSpacing: 3, color: PALETTE.faint }}>
                    小年轮
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {fallbackSrc && (
          <img src={fallbackSrc} alt="分享卡片" className="w-full rounded-2xl border border-line" />
        )}
        {hint && <p className="text-xs text-muted text-center">{hint}</p>}
        <div className="flex gap-2 w-full">
          <button className="btn-soft flex-1" onClick={onClose}>
            关闭
          </button>
          <button className="btn-soft flex-1" onClick={() => void savePng()} disabled={busy}>
            保存为图片
          </button>
          <button className="btn-primary flex-1" onClick={() => void shareToWeChat()} disabled={busy}>
            {busy ? '生成中…' : '发送至微信'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
