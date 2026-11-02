import { useEffect, useState } from 'react'
import { audioObjectUrl } from '../lib/audioStore'

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function AudioAttachment({
  path,
  durationSec
}: {
  path: string
  durationSec: number | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    setUrl(null)
    setMissing(false)
    if (!path) return

    let cancelled = false
    let mine: string | null = null
    audioObjectUrl(path)
      .then((next) => {
        if (cancelled) {
          if (next) URL.revokeObjectURL(next)
          return
        }
        mine = next
        if (next) setUrl(next)
        else setMissing(true)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })

    return () => {
      cancelled = true
      if (mine) URL.revokeObjectURL(mine)
    }
  }, [path])

  const filename = path.split('/').pop() ?? 'recording'

  return (
    <div className="rounded-xl border border-line bg-paper/60 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm">🎤 语音记录</span>
        {durationSec != null && <span className="text-xs text-muted">{fmtSec(durationSec)}</span>}
      </div>
      {url ? (
        <>
          <audio controls preload="metadata" src={url} className="w-full h-9" />
          <a
            className="btn-soft text-xs w-full touch-target"
            href={url}
            download={filename}
            rel="noopener"
          >
            ⬇ 下载录音源文件（{filename}）
          </a>
        </>
      ) : missing ? (
        <div className="text-xs text-muted leading-relaxed">
          这段录音只存在录制它的那台设备上，换设备或清理浏览器数据后无法播放。
        </div>
      ) : (
        <div className="h-9 flex items-center text-xs text-muted">加载中…</div>
      )}
    </div>
  )
}
