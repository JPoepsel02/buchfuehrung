import { describe, expect, test } from 'vitest'
import { isTrustedUpdateAsset } from '../updateSource'

const name = 'Buchfuehrung-1.17.0-arm64.dmg'
const url = `https://github.com/JPoepsel02/buchfuehrung/releases/download/v1.17.0/${name}`

describe('trusted update source', () => {
  test('accepts official release installers with the exact asset filename', () => {
    expect(isTrustedUpdateAsset(name, url)).toBe(true)
    expect(isTrustedUpdateAsset('Buchfuehrung-1.17.0-x64.exe', url.replace(name, 'Buchfuehrung-1.17.0-x64.exe'))).toBe(true)
  })

  test.each([
    url.replace('https:', 'http:'),
    url.replace('github.com', 'github.com.evil.example'),
    url.replace('github.com', 'user:password@github.com'),
    url.replace('/JPoepsel02/', '/someone-else/'),
    url.replace('/buchfuehrung/', '/another-app/'),
    `${url}?download=1`, `${url}#fragment`,
    url.replace('v1.17.0', '..'),
    url.replace('v1.17.0', '%2e%2e'),
    url.replace(name, `folder%2f${name}`),
    url.replace(name, 'different.dmg'),
    url.replace('/releases/download/', '/releases/latest/download/'),
    url.replace('https://', 'https://github.com@'),
  ])('rejects modified release addresses: %s', (address) => {
    expect(isTrustedUpdateAsset(name, address)).toBe(false)
  })

  test.each(['../installer.dmg', '/installer.dmg', 'sub/installer.dmg', 'sub\\installer.dmg', '', 'installer.zip', 'malware.exe', 'Buchfuehrung-\u0000.dmg'])('rejects unsafe or unrelated asset names: %s', (filename) => {
    expect(isTrustedUpdateAsset(filename, url.replace(name, filename))).toBe(false)
  })

  test('rejects missing and malformed runtime values', () => {
    expect(isTrustedUpdateAsset(null, url)).toBe(false)
    expect(isTrustedUpdateAsset(name, undefined)).toBe(false)
    expect(isTrustedUpdateAsset(name, 'not a URL')).toBe(false)
  })
})
