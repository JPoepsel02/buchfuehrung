import { describe, expect, test } from 'vitest'
import { buildMode, isLocalExperiment, runtimePolicyFor } from '../runtime'

describe('runtime policy', () => {
  test.each([undefined, null, '', 'local', 'prod', 'Production', true])('defaults to isolated local mode for %j', (value) => {
    expect(runtimePolicyFor(value)).toEqual({ localExperiment: true, automaticBankFetch: false, updates: false })
  })

  test('enables production features only for the explicit production build mode', () => {
    expect(runtimePolicyFor('production')).toEqual({ localExperiment: false, automaticBankFetch: true, updates: true })
  })

  test('plain test and development imports remain isolated without a build define', () => {
    expect(buildMode).toBe('local')
    expect(isLocalExperiment).toBe(true)
  })
})
