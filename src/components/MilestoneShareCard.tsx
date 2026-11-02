import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import Modal from './Modal'
import { fmtDate } from '../lib/format'
import type { Milestone } from '../lib/types'

const PALETTE = {
  paper: '#EFF1EA',
  ink: '#26302A',
  muted: '#6F7568',
  brand: '#3F6B51'
}

export default function MilestoneShareCard({
  milestone,
  childName,
  open,
  onClose
}: {
  milestone: Milestone | null
  childName?: string
  open: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  if (!milestone) return null

  const exportPng = async () => {
    if (!ref.current) return
    setBusy(true)
    try {
      const url = await toPng(ref.current, { pixelRatio: 2, backgroundColor: PALETTE.paper })
      const a = document.createElement('a')
      a.href = url
      a.download = `小年轮印记-${milestone.title.slice(0, 12)}.png`
      a.click()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="分享完成的印记">
      <div className="flex flex-col items-center gap-4">
        <div
          ref={ref}
          style={{
            width: 1080,
            height: 1440,
            background: PALETTE.paper,
            color: PALETTE.ink,
            display: 'flex',
            flexDirection: 'column',
            padding: 80,
            boxSizing: 'border-box',
            fontFamily: `-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif`
          }}
        >
          <div style={{ fontSize: 28, color: PALETTE.brand, fontWeight: 700, letterSpacing: 4 }}>小年轮</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 36 }}>
            <div style={{ fontSize: 40, color: PALETTE.muted }}>🏅 完成一个成长印记</div>
            <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.3 }}>{milestone.title}</div>
            {milestone.description && (
              <div style={{ fontSize: 32, color: PALETTE.muted, lineHeight: 1.5 }}>{milestone.description}</div>
            )}
            <div style={{ fontSize: 28, color: PALETTE.brand }}>
              {childName ? `${childName} · ` : ''}
              {milestone.completed_at ? fmtDate(milestone.completed_at) : fmtDate(new Date().toISOString())}
            </div>
          </div>
          <div style={{ fontSize: 24, color: PALETTE.muted }}>记录孩子每一步成长</div>
        </div>
        <div className="w-full flex gap-2">
          <button className="btn-soft flex-1 h-11" onClick={onClose}>
            关闭
          </button>
          <button className="btn-primary flex-1 h-11" disabled={busy} onClick={() => void exportPng()}>
            {busy ? '生成中…' : '保存图片'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
