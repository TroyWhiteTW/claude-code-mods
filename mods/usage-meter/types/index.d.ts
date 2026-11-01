export type Limit = { percentUsed: number; resetsAt: number | null }

export type Snapshot = {
  model: string | null
  effort: string | null
  isLight: boolean
  contextTokens: number | null
  contextWindow: number | null
  baseTokens: number | null
  baseCost: number | null
  deltas: number[]
  fiveHour: Limit | null
  sevenDay: Limit | null
  cacheHit: number | null
  lastResponseAt: number | null
  costUsd: number | null
  lastCostUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { snapshot: Shaped<Snapshot>; tick: number }
  }
}
