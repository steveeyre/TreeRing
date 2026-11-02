import { useEffect, useRef, useState } from 'react'

export interface VoiceResult {
  blob: Blob
  ext: string
  durationSec: number
}

export default function VoiceRecorder({
  onResult
}: {
  onResult: (r: VoiceResult) => void
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'ready'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const blobRef = useRef<Blob | null>(null)
  const extRef = useRef('webm')

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      const mime =
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported
          ? candidates.find((c) => MediaRecorder.isTypeSupported(c))
          : undefined
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      extRef.current = mime?.includes('mp4') ? 'm4a' : 'webm'
      mediaRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        blobRef.current = blob
        setPreviewUrl(URL.createObjectURL(blob))
        setState('ready')
        onResult({ blob, ext: extRef.current, durationSec: seconds })
      }
      mr.start()
      setState('recording')
      setSeconds(0)
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch {
      setState('idle')
    }
  }

  const stop = () => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop()
    if (timerRef.current) window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  const retry = () => {
    blobRef.current = null
    setState('idle')
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3">
      {state === 'idle' && (
        <>
          <button
            className="w-12 h-12 rounded-full bg-brand text-white text-xl active:scale-95 transition-transform"
            aria-label="开始录音"
            onClick={() => void start()}
          >
            🎤
          </button>
          <span className="text-sm text-muted">点按开始录音（源文件原样保存，可播放与下载）</span>
        </>
      )}
      {state === 'recording' && (
        <>
          <button
            className="w-12 h-12 rounded-full bg-brand-600 text-white text-xl animate-pulse"
            aria-label="停止录音"
            onClick={stop}
          >
            ⏹
          </button>
          <span className="text-sm font-mono">{fmt(seconds)}</span>
          <span className="text-xs text-brand-600">正在录音…</span>
        </>
      )}
      {state === 'ready' && (
        <>
          {previewUrl && (
            <audio controls src={previewUrl} className="h-10 flex-1 min-w-0" preload="metadata" />
          )}
          <span className="text-xs text-muted whitespace-nowrap">{fmt(seconds)}</span>
          <button className="btn-soft text-sm" onClick={retry}>
            重录
          </button>
        </>
      )}
    </div>
  )
}
