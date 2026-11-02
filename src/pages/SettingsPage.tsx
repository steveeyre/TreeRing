import { useEffect, useRef, useState } from 'react'
import { useAppStore, usePrefs } from '../lib/store'
import {
  createChild,
  createMember,
  exportAllData,
  listDeletedEntries,
  listDeletedGrowth,
  listDeletedHealth,
  previewRestore,
  restoreData,
  restoreEntry,
  restoreGrowthRecord,
  restoreHealthEvent,
  signOut
} from '../lib/data'
import type { DeletedEntry, DeletedGrowth, DeletedHealth, RestorePreview } from '../lib/data'
import { downloadBlob, exportAudioZip, restoreAudioZip } from '../lib/audioBackup'
import { audioUsage, formatBytes } from '../lib/audioStore'
import { runConnectivityDiagnostics, type DiagItem } from '../lib/diagnostics'
import Modal from '../components/Modal'
import { DEFAULT_AI_CONFIG } from '../lib/constants'

export default function SettingsPage() {
  const session = useAppStore((s) => s.session)
  const members = useAppStore((s) => s.members)
  const children = useAppStore((s) => s.children)
  const baseUrl = usePrefs((s) => s.baseUrl)
  const apiKey = usePrefs((s) => s.apiKey)
  const chatModel = usePrefs((s) => s.chatModel)
  const autoParse = usePrefs((s) => s.autoParse)
  const dailyRemind = usePrefs((s) => s.dailyRemind)
  const lastBackupAt = usePrefs((s) => s.lastBackupAt)
  const hideShareName = usePrefs((s) => s.hideShareName)
  const setLastBackupAt = usePrefs((s) => s.setLastBackupAt)
  const setHideShareName = usePrefs((s) => s.setHideShareName)
  const setAi = usePrefs((s) => s.setAi)
  const setDailyRemind = usePrefs((s) => s.setDailyRemind)

  const [aiForm, setAiForm] = useState({
    baseUrl,
    apiKey,
    chatModel
  })
  const [aiSaved, setAiSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const backupRef = useRef<HTMLInputElement>(null)
  const audioZipRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [restoreText, setRestoreText] = useState<string | null>(null)
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null)
  const [restoreDetails, setRestoreDetails] = useState<string[]>([])
  const [audioProgress, setAudioProgress] = useState<string | null>(null)
  const [localAudio, setLocalAudio] = useState<{ count: number; bytes: number } | null>(null)
  const [diags, setDiags] = useState<DiagItem[] | null>(null)
  const [diagRunning, setDiagRunning] = useState(false)
  const deepLink = `${location.origin}${location.pathname}#/new`

  const [addChild, setAddChild] = useState(false)
  const [childForm, setChildForm] = useState({ name: '', birth_date: '', gender: '' })

  const [addMember, setAddMember] = useState(false)
  const [memberForm, setMemberForm] = useState({ name: '', emoji: '🧑', color: '#3F6B51' })

  const [binOpen, setBinOpen] = useState(false)
  const [binLoading, setBinLoading] = useState(false)
  const [binError, setBinError] = useState<string | null>(null)
  const [binEntries, setBinEntries] = useState<DeletedEntry[]>([])
  const [binGrowth, setBinGrowth] = useState<DeletedGrowth[]>([])
  const [binHealth, setBinHealth] = useState<DeletedHealth[]>([])
  const [binMsg, setBinMsg] = useState<string | null>(null)

  const loadBin = async () => {
    setBinLoading(true)
    setBinError(null)
    try {
      const [e, g, h] = await Promise.all([listDeletedEntries(), listDeletedGrowth(), listDeletedHealth()])
      setBinEntries(e)
      setBinGrowth(g)
      setBinHealth(h)
    } catch (err) {
      setBinError(err instanceof Error ? err.message : '回收站加载失败')
    } finally {
      setBinLoading(false)
    }
  }

  useEffect(() => {
    if (binOpen) void loadBin()
  }, [binOpen])

  const saveAI = () => {
    setAi({
      baseUrl: aiForm.baseUrl.trim() || DEFAULT_AI_CONFIG.baseUrl,
      apiKey: aiForm.apiKey.trim(),
      chatModel: aiForm.chatModel.trim() || DEFAULT_AI_CONFIG.chatModel
    })
    setAiSaved(true)
    setTimeout(() => setAiSaved(false), 2000)
  }

  const doBackup = async () => {
    setBusy(true)
    try {
      const result = await exportAllData()
      const blob = new Blob([result.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `小年轮备份-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setLastBackupAt(new Date().toISOString())
      const summary = Object.entries(result.counts)
        .map(([t, n]) => `${t} ${n}`)
        .join('，')
      setMsg({
        ok: true,
        text: `备份已校验下载：${summary}。录音源文件不在 JSON 内，可另导出录音 ZIP。`
      })
    } catch (e) {
      setMsg({ ok: false, text: `备份失败：${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  function handleRestoreFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setRestoreText(text)
      void previewRestore(text)
        .then(setRestorePreview)
        .catch((e) =>
          setRestorePreview({
            ok: false,
            tables: [],
            errors: [e instanceof Error ? e.message : '预览失败']
          })
        )
    }
    reader.readAsText(f)
  }

  async function doRestore() {
    if (!restoreText) return
    setBusy(true)
    const r = await restoreData(restoreText)
    setRestoreText(null)
    setRestorePreview(null)
    setBusy(false)
    setRestoreDetails(r.details.filter((d) => d.count > 0 || d.error).map((d) =>
      d.ok ? `${d.table}：${d.count} 条` : `${d.table}：失败（${d.error}）· 已写入 ${d.count}`
    ))
    setMsg(
      r.ok
        ? { ok: true, text: '恢复完成，明细见下方列表' }
        : { ok: false, text: `恢复未完全成功：${r.error}` }
    )
  }

  useEffect(() => {
    let alive = true
    audioUsage()
      .then((u) => {
        if (alive) setLocalAudio(u)
      })
      .catch(() => {
        if (alive) setLocalAudio(null)
      })
    return () => {
      alive = false
    }
  }, [audioProgress])

  async function doExportAudioZip() {
    setBusy(true)
    setAudioProgress('准备中…')
    const r = await exportAudioZip((p) =>
      setAudioProgress(`读取本机录音 ${p.done}/${p.total}${p.current ? `（${p.current}）` : ''}`)
    )
    setBusy(false)
    setAudioProgress(null)
    if (r.blob) {
      downloadBlob(r.blob, `小年轮录音-${new Date().toISOString().slice(0, 10)}.zip`)
      setMsg({
        ok: r.ok,
        text: r.ok
          ? `录音 ZIP 已下载（${r.missing.length === 0 ? '完整' : '有缺失'}）`
          : `录音 ZIP 已下载，但有 ${r.missing.length} 条缺失`
      })
    } else {
      setMsg({ ok: false, text: `录音导出失败：${r.error}` })
    }
  }

  async function doRestoreAudioZip(file: File) {
    setBusy(true)
    setAudioProgress('校验并写入本机…')
    const r = await restoreAudioZip(file, (p) =>
      setAudioProgress(`恢复附件 ${p.done}/${p.total}`)
    )
    setBusy(false)
    setAudioProgress(null)
    setMsg({
      ok: r.ok,
      text: r.ok
        ? `录音恢复完成：恢复 ${r.restored} 条，跳过 ${r.skipped} 条`
        : `录音恢复：成功 ${r.restored}，跳过 ${r.skipped}，失败 ${r.missing.length}${r.error ? `（${r.error}）` : ''}`
    })
  }

  return (
    <div className="min-h-full px-4 pt-4 pb-28 space-y-5">
      {msg && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm flex items-center gap-2 ${
            msg.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          <span className="flex-1">{msg.text}</span>
          <button aria-label="关闭" className="w-8 h-8 touch-target" onClick={() => setMsg(null)}>
            ✕
          </button>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted px-1">账号</h3>
        <div className="card p-4 flex items-center justify-between">
          <p className="text-sm text-muted truncate">{session?.user.email}</p>
          <button className="btn-soft text-sm" onClick={() => void signOut()}>
            退出登录
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted px-1">孩子</h3>
        <div className="card p-4 space-y-2">
          {children.map((c) => (
            <div key={c.id} className="flex items-center gap-3">
              <span
                className="w-9 h-9 rounded-lg flex items-center justify-center text-lg"
                style={{ background: `${c.avatar_color}1A` }}
              >
                {c.gender === 'boy' ? '👦' : c.gender === 'girl' ? '👧' : '🧒'}
              </span>
              <span className="flex-1 text-sm">{c.name}</span>
            </div>
          ))}
          <button className="btn-soft w-full text-sm" onClick={() => setAddChild(true)}>
            + 添加孩子
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted px-1">记录人</h3>
        <div className="card p-4 space-y-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center text-lg"
                style={{ background: `${m.color}1A` }}
              >
                {m.emoji}
              </span>
              <span className="flex-1 text-sm">{m.name}</span>
            </div>
          ))}
          <button className="btn-soft w-full text-sm" onClick={() => setAddMember(true)}>
            + 添加记录人
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted px-1">每日提醒</h3>
        <div className="card p-4 space-y-2">
          <button
            className={`w-full h-11 rounded-xl border-2 text-sm flex items-center justify-between px-4 ${
              dailyRemind ? 'border-brand bg-brand/5 text-brand' : 'border-line bg-white text-muted'
            }`}
            onClick={() => setDailyRemind(!dailyRemind)}
          >
            <span>每天 21:15 若无记录，进入应用时提醒</span>
            <span className="text-xs">{dailyRemind ? '已开启' : '已关闭'}</span>
          </button>
          <button
            className="btn-soft w-full text-sm"
            onClick={async () => {
              if (!('Notification' in window)) {
                alert('当前浏览器不支持系统通知')
                return
              }
              const p = await Notification.requestPermission()
              alert(p === 'granted' ? '已开启系统通知 ✓（应用打开时也会弹通知栏）' : '未授权，将只显示应用内横幅')
            }}
          >
            🔔 开启系统通知（需授权）
          </button>
          <p className="text-[11px] text-muted leading-relaxed">
            PWA 无法常驻后台；应用在打开或切回前台时会自动检查。授权系统通知后，提醒会同时出现在通知栏。
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted px-1">AI 设置</h3>
        <div className="card p-4 space-y-3">
          <div>
            <label className="text-xs text-muted">API 地址（OpenAI 兼容，Base URL）</label>
            <input
              className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
              placeholder="https://api.openai.com/v1"
              value={aiForm.baseUrl}
              onChange={(e) => setAiForm({ ...aiForm, baseUrl: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-muted">API Key（仅保存在本机浏览器）</label>
            <div className="mt-1 flex gap-2">
              <input
                className="flex-1 h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                type={showKey ? 'text' : 'password'}
                placeholder="sk-…"
                value={aiForm.apiKey}
                onChange={(e) => setAiForm({ ...aiForm, apiKey: e.target.value })}
              />
              <button
                className="btn-soft px-3"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted">对话模型</label>
            <input
              className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
              value={aiForm.chatModel}
              onChange={(e) => setAiForm({ ...aiForm, chatModel: e.target.value })}
            />
          </div>
          <button
            className={`w-full h-11 rounded-xl border-2 text-sm flex items-center justify-between px-4 ${
              autoParse ? 'border-brand bg-brand/5 text-brand' : 'border-line bg-white text-muted'
            }`}
            onClick={() => setAi({ autoParse: !autoParse })}
          >
            <span>保存后自动用 AI 解析归类</span>
            <span className="text-xs">{autoParse ? '已开启' : '已关闭'}</span>
          </button>
          <button className="btn-primary w-full" onClick={saveAI}>
            {aiSaved ? '已保存 ✓' : '保存 AI 设置'}
          </button>
          <p className="text-[11px] text-muted leading-relaxed">
            仅在你调用 AI 时产生 API 费用。Key 只存在本设备浏览器里，不会上传到数据库或仓库。
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted px-1">数据备份 / 恢复</h3>
        <div className="card p-4 space-y-3">
          <button className="btn-primary w-full h-11" disabled={busy} onClick={() => void doBackup()}>
            ⬇️ 下载完整备份（JSON）
          </button>
          <button className="btn-soft w-full h-11" disabled={busy} onClick={() => void doExportAudioZip()}>
            🎙️ 导出录音 ZIP
          </button>
          <p className="text-[11px] text-muted leading-relaxed">
            录音只保存在这台设备的浏览器里（IndexedDB）。
            {localAudio
              ? ` 当前本机有 ${localAudio.count} 段，约占用 ${formatBytes(localAudio.bytes)}。`
              : ' 当前浏览器不支持本地录音存储。'}
          </p>
          <button className="btn-soft w-full h-11" disabled={busy} onClick={() => backupRef.current?.click()}>
            ⬆️ 从 JSON 备份恢复
          </button>
          <button className="btn-soft w-full h-11" disabled={busy} onClick={() => audioZipRef.current?.click()}>
            🎙️ 恢复录音 ZIP
          </button>
          <input
            ref={backupRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleRestoreFile(f)
              e.target.value = ''
            }}
          />
          <input
            ref={audioZipRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doRestoreAudioZip(f)
              e.target.value = ''
            }}
          />
          {audioProgress && <p className="text-xs text-muted">{audioProgress}</p>}
          <button className="btn-soft w-full h-11" onClick={() => setBinOpen(true)}>
            🗑️ 回收站
          </button>
          <p className="text-[11px] text-muted leading-relaxed">
            录音不进 JSON 备份，换设备或换浏览器只能靠录音 ZIP 迁移；恢复时先 JSON 再录音 ZIP（只挂到当前账号已有条目）。JSON 备份含软删除项。
            {lastBackupAt ? ` 上次备份：${lastBackupAt.slice(0, 10)}` : ' 尚未记录过备份完成时间。'}
          </p>
          <button
            className="btn-soft w-full h-11"
            onClick={() => setHideShareName(!hideShareName)}
          >
            🔒 分享时隐藏孩子真名：{hideShareName ? '开' : '关'}
          </button>
          <p className="text-[11px] text-muted leading-relaxed">
            该开关只影响分享卡片；不改变档案里的称呼。
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted px-1">安装到主屏 / 快捷记录</h3>
        <div className="card p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">添加到主屏幕</p>
            <p className="text-xs text-muted leading-relaxed">
              <b>iPhone Safari</b>：分享 → 添加到主屏幕。<br />
              <b>Android Chrome</b>：菜单 → 安装应用 / 添加到主屏幕。<br />
              <b>电脑 Chrome/Edge</b>：地址栏安装图标，或菜单 → 安装小年轮。
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">快捷深链（直达记录页）</p>
            <p className="text-[11px] text-muted break-all font-mono">{deepLink}</p>
            <p className="text-xs text-muted leading-relaxed">
              可把该地址存为桌面书签，或配合系统悬浮球/快捷指令一键打开记录。应用不承诺常驻后台定时提醒。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-soft flex-1 h-11 text-sm"
              onClick={() => {
                void navigator.clipboard?.writeText(deepLink)
                setMsg({ ok: true, text: '深链已复制' })
              }}
            >
              复制深链
            </button>
            <a className="btn-primary flex-1 h-11 text-sm flex items-center justify-center" href="#/new">
              打开记录页
            </a>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted px-1">网络连通性自检</h3>
        <div className="card p-4 space-y-3">
          <p className="text-[11px] text-muted leading-relaxed">
            分层检查：页面入口 / 登录 / 数据库 / AI。仅 AI 失败时，记录与档案仍可正常使用。
          </p>
          <button
            className="btn-soft w-full h-11 text-sm"
            disabled={diagRunning}
            onClick={() => {
              setDiagRunning(true)
              setDiags(null)
              void runConnectivityDiagnostics()
                .then(setDiags)
                .finally(() => setDiagRunning(false))
            }}
          >
            {diagRunning ? '检测中…' : '开始检测'}
          </button>
          {diags && (
            <div className="space-y-2">
              {diags.map((d) => (
                <div key={d.key} className="flex items-start gap-2 text-xs border border-line rounded-xl px-3 py-2">
                  <span className="shrink-0 mt-0.5">
                    {d.status === 'ok' ? '✅' : d.status === 'fail' ? '❌' : d.status === 'skip' ? '⏭️' : '…'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{d.label}</p>
                    <p className="text-muted break-words">{d.detail}</p>
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-muted leading-relaxed">
                手机端请分别在家庭宽带与流量下各测一次（不要开 VPN），并对比不同时间段。结果仅代表当前网络瞬时状态。
              </p>
            </div>
          )}
        </div>
      </section>

      <Modal open={binOpen} onClose={() => setBinOpen(false)} title="回收站">
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {binLoading && <p className="text-sm text-muted">加载中…</p>}
          {binError && (
            <div className="space-y-2">
              <p className="text-sm text-red-700">{binError}</p>
              <button className="btn-soft" onClick={() => void loadBin()}>
                重试
              </button>
            </div>
          )}
          {binMsg && <p className="text-sm text-green-700">{binMsg}</p>}
          {!binLoading && !binError && (
            <>
              <p className="text-xs text-muted leading-relaxed">
                已删除的记录会先放在这里，可恢复。应用内不做永久删除。
              </p>
              <section className="space-y-2">
                <h4 className="text-xs font-semibold text-muted">记录（{binEntries.length}）</h4>
                {binEntries.length === 0 && <p className="text-xs text-muted">暂无</p>}
                {binEntries.map((e) => (
                  <div key={e.id} className="flex items-start gap-2 border border-line rounded-xl p-3">
                    <p className="flex-1 text-sm line-clamp-2">{e.body || '（空正文）'}</p>
                    <button
                      className="btn-soft text-xs shrink-0 h-9 px-3"
                      onClick={async () => {
                        await restoreEntry(e.id)
                        setBinMsg('记录已恢复')
                        void loadBin()
                      }}
                    >
                      恢复
                    </button>
                  </div>
                ))}
              </section>
              <section className="space-y-2">
                <h4 className="text-xs font-semibold text-muted">生长测量（{binGrowth.length}）</h4>
                {binGrowth.length === 0 && <p className="text-xs text-muted">暂无</p>}
                {binGrowth.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 border border-line rounded-xl p-3">
                    <p className="flex-1 text-sm">
                      {g.measured_at}
                      {g.height_cm != null ? ` · ${g.height_cm}cm` : ''}
                      {g.weight_kg != null ? ` · ${g.weight_kg}kg` : ''}
                    </p>
                    <button
                      className="btn-soft text-xs shrink-0 h-9 px-3"
                      onClick={async () => {
                        await restoreGrowthRecord(g.id)
                        setBinMsg('生长记录已恢复')
                        void loadBin()
                      }}
                    >
                      恢复
                    </button>
                  </div>
                ))}
              </section>
              <section className="space-y-2">
                <h4 className="text-xs font-semibold text-muted">健康事件（{binHealth.length}）</h4>
                {binHealth.length === 0 && <p className="text-xs text-muted">暂无</p>}
                {binHealth.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 border border-line rounded-xl p-3">
                    <p className="flex-1 text-sm">
                      {h.title}
                      {h.occurred_at ? ` · ${h.occurred_at}` : ''}
                    </p>
                    <button
                      className="btn-soft text-xs shrink-0 h-9 px-3"
                      onClick={async () => {
                        await restoreHealthEvent(h.id)
                        setBinMsg('健康记录已恢复')
                        void loadBin()
                      }}
                    >
                      恢复
                    </button>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </Modal>

      <Modal open={addChild} onClose={() => setAddChild(false)} title="添加孩子">
        <div className="space-y-4">
          <input
            className="w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
            placeholder="名字 / 小名"
            value={childForm.name}
            onChange={(e) => setChildForm({ ...childForm, name: e.target.value })}
          />
          <input
            type="date"
            className="w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none"
            value={childForm.birth_date}
            onChange={(e) => setChildForm({ ...childForm, birth_date: e.target.value })}
          />
          <div className="grid grid-cols-3 gap-2">
            {[
              ['boy', '男孩'],
              ['girl', '女孩'],
              ['', '保密']
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`h-10 rounded-xl border text-sm ${
                  childForm.gender === v ? 'border-brand bg-brand/5 text-brand' : 'border-line bg-white text-ink'
                }`}
                onClick={() => setChildForm({ ...childForm, gender: v })}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="btn-primary w-full"
            disabled={!childForm.name.trim()}
            onClick={() => {
              void createChild({
                name: childForm.name.trim(),
                birth_date: childForm.birth_date || null,
                gender: childForm.gender || null
              })
              setAddChild(false)
            }}
          >
            添加
          </button>
        </div>
      </Modal>

      <Modal open={!!restoreText} onClose={() => { setRestoreText(null); setRestorePreview(null) }} title="恢复前预览">
        <div className="space-y-3 text-sm">
          <p className="text-ink leading-relaxed">
            将按 id <b>upsert</b>（同 id 覆盖，新 id 新增），<b>不会删除</b>备份中不存在的数据。建议先下载当前备份。
          </p>
          {restorePreview && (
            <div className="space-y-2">
              {restorePreview.exportedAt && (
                <p className="text-xs text-muted">备份时间：{restorePreview.exportedAt}</p>
              )}
              {restorePreview.schemaVersion != null && (
                <p className="text-xs text-muted">schema_version：{restorePreview.schemaVersion}</p>
              )}
              <div className="border border-line rounded-xl overflow-hidden">
                {restorePreview.tables.filter((t) => t.total > 0).map((t) => (
                  <div key={t.table} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-0 text-xs">
                    <span className="font-medium flex-1">{t.table}</span>
                    <span className="text-muted">共 {t.total}</span>
                    <span className="text-green-700">新增 {t.insert}</span>
                    <span className="text-amber-700">覆盖 {t.update}</span>
                  </div>
                ))}
                {restorePreview.tables.every((t) => t.total === 0) && (
                  <p className="px-3 py-2 text-xs text-muted">备份中没有可恢复的业务数据</p>
                )}
              </div>
              {restorePreview.errors.map((e) => (
                <p key={e} className="text-xs text-red-700">{e}</p>
              ))}
            </div>
          )}
          {restoreDetails.length > 0 && (
            <ul className="text-xs text-muted space-y-1 list-disc pl-4">
              {restoreDetails.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-3 pt-2">
            <button className="btn-soft flex-1 h-11" onClick={() => { setRestoreText(null); setRestorePreview(null) }}>
              取消
            </button>
            <button className="btn-primary flex-1 h-11" disabled={busy} onClick={() => void doRestore()}>
              {busy ? '恢复中…' : '确认恢复'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={addMember} onClose={() => setAddMember(false)} title="添加记录人">
        <div className="space-y-4">
          <input
            className="w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
            placeholder="称呼，如：爷爷"
            value={memberForm.name}
            onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
          />
          <div className="flex gap-2">
            <input
              className="w-20 h-11 rounded-xl border border-line bg-white px-3 text-center text-xl outline-none"
              value={memberForm.emoji}
              onChange={(e) => setMemberForm({ ...memberForm, emoji: e.target.value })}
            />
            <div className="flex-1 flex items-center gap-2">
              {['#3F6B51', '#A9762F', '#8E4A38', '#5C7A99', '#7A6A9B', '#8A8F5C'].map((c) => (
                <button
                  key={c}
                  className={`w-9 h-9 rounded-full ${memberForm.color === c ? 'ring-2 ring-offset-2 ring-ink' : ''}`}
                  style={{ background: c }}
                  onClick={() => setMemberForm({ ...memberForm, color: c })}
                />
              ))}
            </div>
          </div>
          <button
            className="btn-primary w-full"
            disabled={!memberForm.name.trim()}
            onClick={() => {
              void createMember({
                name: memberForm.name.trim(),
                emoji: memberForm.emoji || '🧑',
                color: memberForm.color
              })
              setAddMember(false)
            }}
          >
            添加
          </button>
        </div>
      </Modal>
    </div>
  )
}
