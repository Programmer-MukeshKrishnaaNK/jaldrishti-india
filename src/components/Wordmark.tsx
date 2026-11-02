import './Wordmark.css'

export function Wordmark() {
  return (
    <span className="wordmark">
      <svg className="wordmark-mark" viewBox="0 0 32 32" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 6 Q16 34 28 6" />
          <path d="M9 6 Q16 26 23 6" />
          <path d="M13.5 6 Q16 17 18.5 6" />
        </g>
        <circle cx="16" cy="25" r="2.6" fill="var(--paani)" />
      </svg>
      <span className="wordmark-name" aria-hidden="true">
        paanipulse
      </span>
      <span className="visually-hidden">PaaniPulse</span>
    </span>
  )
}
