import type { CSSProperties } from 'react'

const paths = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  book: <><path d="M4 4h13a3 3 0 0 1 3 3v14H7a3 3 0 0 1-3-3Zm0 13h16M8 4v13M11 8h5M11 11h4" /></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 17h2" /></>,
  import: <><path d="M12 3v12m-4-4 4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
  report: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 15l2 2 5-5" /></>,
  settings: <><path d="m9 3-.6 2.4-2.1 1.2L4 6l-2 3.5 1.7 1.7v2.5L2 15.5 4 19l2.3-.6 2.1 1.2L9 22h4l.6-2.4 2.1-1.2 2.3.6 2-3.5-1.7-1.8v-2.5L20 9.5 18 6l-2.3.6-2.1-1.2L13 3Z" /><circle cx="11" cy="12.5" r="3" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M6 8v.01M6 12v.01" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  income: <path d="M6 6h12v12M18 6 6 18" />,
  expense: <path d="M6 6v12h12M6 18 18 6" />,
  wallet: <><path d="M4 7V5a2 2 0 0 1 2-2h12v4M4 7h16v14H6a2 2 0 0 1-2-2ZM20 11h-5v6h5" /><path d="M16 14h.01" /></>,
  turnover: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
} as const

export type IconName = keyof typeof paths

/** One stroke vocabulary for navigation, actions and financial signals. */
export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0, ...style }}>{paths[name]}</svg>
}
