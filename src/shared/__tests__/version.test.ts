import { describe, expect, test } from 'vitest'
import { compareVersions, pickAsset } from '../version'

describe('compareVersions', () => {
  test('erkennt neuere Version', () => {
    expect(compareVersions('1.2.0', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.0', '1.1.9')).toBeGreaterThan(0)
  })

  test('vergleicht numerisch, nicht alphabetisch', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })

  test('Gleichstand und ältere Version', () => {
    expect(compareVersions('1.2.0', 'v1.2.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.2.1')).toBeLessThan(0)
  })

  test('unterschiedlich viele Stellen', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0)
  })
})

describe('pickAsset', () => {
  const assets = [
    { name: 'Buchfuehrung-1.2.0-arm64.dmg', browser_download_url: 'u1' },
    { name: 'Buchfuehrung-1.2.0-x64.dmg', browser_download_url: 'u2' },
    { name: 'Buchfuehrung-1.2.0-arm64-mac.zip', browser_download_url: 'u3' },
    { name: 'Buchfuehrung-Setup-1.2.0.exe', browser_download_url: 'u4' },
  ]

  test('macOS Apple Silicon bekommt die arm64-DMG', () => {
    expect(pickAsset(assets, 'darwin', 'arm64')?.name).toBe('Buchfuehrung-1.2.0-arm64.dmg')
  })

  test('macOS Intel bekommt die DMG ohne arm64', () => {
    expect(pickAsset(assets, 'darwin', 'x64')?.name).toBe('Buchfuehrung-1.2.0-x64.dmg')
  })

  test('Windows bekommt die Setup-EXE', () => {
    expect(pickAsset(assets, 'win32', 'x64')?.name).toBe('Buchfuehrung-Setup-1.2.0.exe')
  })

  test('liefert null, wenn nichts passt', () => {
    expect(pickAsset([], 'darwin', 'arm64')).toBeNull()
    expect(pickAsset(assets, 'linux', 'x64')).toBeNull()
  })
})
