export default function LoadError({
  message,
  onRetry
}: {
  message?: string | null
  onRetry?: () => void
}) {
  return (
    <div className="text-center py-16 px-6 space-y-3">
      <div className="text-3xl">⚠️</div>
      <p className="text-sm text-ink">{message || '加载失败，请检查网络后重试'}</p>
      <p className="text-xs text-muted">这不是「没有数据」，而是本次请求没有成功。</p>
      {onRetry && (
        <button className="btn-primary h-11 px-6" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}
