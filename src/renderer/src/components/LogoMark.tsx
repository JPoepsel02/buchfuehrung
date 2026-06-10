/**
 * Zeigt das hochgeladene Vereinslogo oder – wenn keins gesetzt ist –
 * die neutrale „B“-Wortmarke der App.
 */
export function LogoMark({ logo, size = 30 }: { logo?: string | null; size?: number }) {
  if (logo) {
    return <img src={logo} alt="" width={size} height={size} style={{ objectFit: 'contain' }} />
  }
  return (
    <span className="logo-mark" style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }} aria-hidden>
      B
    </span>
  )
}
