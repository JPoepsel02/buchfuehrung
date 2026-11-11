import { expect, test } from 'vitest'
import { isSafeLogoDataUrl } from '../logo'

test.each(['png', 'jpeg', 'webp'])('accepts raster data URLs: %s', (kind) => {
  expect(isSafeLogoDataUrl(`data:image/${kind};base64,YWJjZA==`)).toBe(true)
})
test.each([null, undefined, '', 5, 'https://example.com/logo.png', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,x" onerror="alert(1)', 'data:image/png;base64,', 'data:text/html;base64,YQ=='])('rejects unsafe logos: %s', (value) => {
  expect(isSafeLogoDataUrl(value)).toBe(false)
})
test('rejects oversized data', () => expect(isSafeLogoDataUrl('data:image/png;base64,' + 'A'.repeat(8_000_000))).toBe(false))
