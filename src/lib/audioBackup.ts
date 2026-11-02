import { apiListRows, apiUpdateRow } from './api'
import { audioKey, getAudio, putAudio } from './audioStore'
import { useAppStore } from './store'
import { createZip, parseZip } from './zip'

export interface AudioManifestItem {
  entryId: string
  audioPath: string
  zipPath: string
  mime?: string
  size: number
}

export interface AudioExportProgress {
  done: number
  total: number
  current?: string
}

export interface AudioExportResult {
  ok: boolean
  blob?: Blob
  missing: string[]
  error?: string
}

function userId(): string {
  const id = useAppStore.getState().session?.user.id
  if (!id) throw new Error('未登录')
  return id
}

function extFromPath(path: string): string {
  const m = path.match(/\.([a-z0-9]+)$/i)
  return m?.[1] ?? 'bin'
}

function mimeFromExt(ext: string): string {
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'webm') return 'audio/webm'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'ogg') return 'audio/ogg'
  return 'application/octet-stream'
}

/**
 * Pack every audio clip that lives in this browser into a ZIP.
 * The ZIP is the only way to move recordings to another device, since the server keeps
 * nothing but the audio_path key.
 */
export async function exportAudioZip(
  onProgress?: (p: AudioExportProgress) => void
): Promise<AudioExportResult> {
  userId()
  const missing: string[] = []
  try {
    const list = await apiListRows<{ id: string; audio_path: string }>('entries', {
      notNull: ['audio_path'],
      order: [{ col: 'occurred_at', desc: true }]
    })
    const files: { name: string; data: Uint8Array }[] = []
    const manifest: AudioManifestItem[] = []

    let done = 0
    for (const row of list) {
      onProgress?.({ done, total: list.length, current: row.audio_path })
      let data: Blob | null = null
      try {
        const rec = await getAudio(row.audio_path)
        data = rec?.blob ?? null
      } catch {
        data = null
      }
      if (!data) {
        missing.push(row.audio_path)
        done++
        continue
      }
      const bytes = new Uint8Array(await data.arrayBuffer())
      const ext = extFromPath(row.audio_path)
      const zipPath = `${row.id}/${crypto.randomUUID()}.${ext}`
      files.push({ name: zipPath, data: bytes })
      manifest.push({
        entryId: row.id,
        audioPath: row.audio_path,
        zipPath,
        mime: mimeFromExt(ext),
        size: bytes.length
      })
      done++
      onProgress?.({ done, total: list.length })
    }

    const backupId = crypto.randomUUID()
    const manifestJson = JSON.stringify(
      {
        app: 'mengya',
        kind: 'audio-zip',
        backup_id: backupId,
        exported_at: new Date().toISOString(),
        items: manifest,
        missing
      },
      null,
      2
    )
    files.push({
      name: 'manifest.json',
      data: new TextEncoder().encode(manifestJson)
    })
    const blob = createZip(files)
    return { ok: missing.length === 0, blob, missing, error: missing.length ? '部分音频缺失' : undefined }
  } catch (e) {
    return { ok: false, missing, error: e instanceof Error ? e.message : '导出失败' }
  }
}

export interface AudioRestoreResult {
  ok: boolean
  restored: number
  skipped: number
  missing: string[]
  error?: string
}

/** Restore audio from ZIP into this browser; only attaches to entries that exist in current account. */
export async function restoreAudioZip(
  file: File | Blob,
  onProgress?: (p: AudioExportProgress) => void
): Promise<AudioRestoreResult> {
  const uid = userId()
  const missing: string[] = []
  let restored = 0
  let skipped = 0
  try {
    const buf = await file.arrayBuffer()
    const entries = parseZip(buf)
    const manifestFile = entries.find((e) => e.name === 'manifest.json')
    if (!manifestFile) return { ok: false, restored, skipped, missing, error: 'ZIP 内缺少 manifest.json' }
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.data)) as {
      items?: AudioManifestItem[]
    }
    const items = manifest.items ?? []
    let done = 0
    for (const item of items) {
      onProgress?.({ done, total: items.length, current: item.entryId })
      const zipEntry = entries.find((e) => e.name === item.zipPath)
      if (!zipEntry) {
        missing.push(item.entryId)
        done++
        continue
      }
      const owner = await apiListRows<{ id: string; user_id: string }>('entries', {
        eq: { id: item.entryId },
        limit: 1
      })
      const entryRow = owner[0]
      if (!entryRow || entryRow.user_id !== uid) {
        skipped++
        done++
        continue
      }
      const ext = extFromPath(item.audioPath || item.zipPath)
      const newPath = audioKey(uid, item.entryId, ext)
      const blob = new Blob([zipEntry.data as unknown as BlobPart], {
        type: item.mime || mimeFromExt(ext)
      })
      try {
        await putAudio(newPath, blob, null)
      } catch {
        missing.push(item.entryId)
        done++
        continue
      }
      await apiUpdateRow('entries', item.entryId, { audio_path: newPath })
      restored++
      done++
      onProgress?.({ done, total: items.length })
    }
    return {
      ok: missing.length === 0,
      restored,
      skipped,
      missing,
      error: missing.length ? `有 ${missing.length} 条附件恢复失败` : undefined
    }
  } catch (e) {
    return {
      ok: false,
      restored,
      skipped,
      missing,
      error: e instanceof Error ? e.message : '恢复失败'
    }
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
