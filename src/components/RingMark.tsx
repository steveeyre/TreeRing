export default function RingMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="24" cy="24" r="2.6" fill="currentColor" />
      <circle cx="24" cy="24" r="8.5" stroke="currentColor" strokeWidth="1.7" opacity="0.9" />
      <circle cx="24" cy="24" r="14.5" stroke="currentColor" strokeWidth="1.4" opacity="0.65" />
      <circle cx="24" cy="24" r="20.5" stroke="currentColor" strokeWidth="1.2" opacity="0.4" strokeDasharray="58 5" />
    </svg>
  )
}
