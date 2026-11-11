import { useLayoutEffect, useMemo, useRef, useState } from 'react'

export function ReportPreview({ html, title, width }: { html: string; title: string; width: number }) {
  const container = useRef<HTMLElement>(null)
  const [available, setAvailable] = useState(width)
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => setAvailable(Math.max(1, element.clientWidth - 18))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const preview = useMemo(() => html.replace('</head>', `<style>@media screen { body { width:${width}px; zoom:${Math.min(1, available / width)}; } }</style></head>`), [html, width, available])
  return <section className="org-report-preview" ref={container}>
    <iframe title={title} sandbox="" srcDoc={preview} />
  </section>
}
