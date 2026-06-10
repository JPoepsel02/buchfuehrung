declare module '*.png' {
  const url: string
  export default url
}

declare module '*.png?inline' {
  /** Asset als Data-URL (für eigenständige HTML-Dokumente wie den Prüfbericht) */
  const dataUrl: string
  export default dataUrl
}
