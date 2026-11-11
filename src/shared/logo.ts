export function isSafeLogoDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 8_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
}
