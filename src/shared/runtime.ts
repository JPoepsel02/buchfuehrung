declare const __BUCHFUEHRUNG_BUILD_MODE__: unknown

export type BuildMode = 'local' | 'production'

export function runtimePolicyFor(value: unknown) {
  const localExperiment = value !== 'production'
  return { localExperiment, automaticBankFetch: !localExperiment, updates: !localExperiment }
}

export const buildMode: BuildMode = typeof __BUCHFUEHRUNG_BUILD_MODE__ !== 'undefined'
  && __BUCHFUEHRUNG_BUILD_MODE__ === 'production' ? 'production' : 'local'
export const isLocalExperiment = buildMode !== 'production'
export const runtimePolicy = { localExperiment: isLocalExperiment, automaticBankFetch: !isLocalExperiment, updates: !isLocalExperiment }
