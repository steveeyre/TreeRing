import type { ReactNode } from 'react'

export default function Modal({
  open,
  onClose,
  title,
  children
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-paper rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col overflow-hidden safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <h2 className="font-semibold text-base">{title}</h2>
          <button
            aria-label="关闭"
            className="w-11 h-11 -mr-2 flex items-center justify-center text-muted touch-target"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}