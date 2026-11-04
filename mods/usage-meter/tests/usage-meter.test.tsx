import type { On, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { modelLabel, tokenLabel } from '../hooks/register'
import type { Snapshot } from '../types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const AT = Date.parse('2026-11-01T10:00:00Z')

const FG = '#d9dbe0'
const LIGHT_FG = '#1f2328'
const AMBER = '#e2b340'
const RED = '#f07068'

const SNAPSHOT: Snapshot = {
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  isLight: false,
  contextTokens: 48000,
  contextWindow: 1000000,
  baseTokens: 48000,
  baseCost: 1.84,
  deltas: [1900, 600, 3600, 400, 5300],
  fiveHour: { percentUsed: 22, resetsAt: AT + 3 * HOUR },
  sevenDay: { percentUsed: 35, resetsAt: AT + 86 * HOUR },
  cacheHit: 0.98,
  lastResponseAt: AT - 6 * MINUTE,
  cacheTtl: null,
  costUsd: 1.84,
  lastCostUsd: 0.12,
}

const BAND = {
  plugin: 'usage-meter',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 200,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const USAGE: SessionUsage = {
  startedAt: AT,
  context: { tokens: 48000, window: 1000000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 22, resetsAt: new Date(AT + 3 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 35 },
  ],
  cost: { usd: 1 },
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

const TURN = {
  answer: '',
  durationMs: 1,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  usage: {
    model: 'claude-opus-5-5',
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 980,
    cache_creation_input_tokens: 10,
  },
} as const

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as const

const SWITCH = {
  from_model: 'claude-opus-5-5',
  to_model: 'claude-sonnet-5-5',
  requested_model: 'sonnet',
  source: 'command',
  context_tokens: 0,
  prompt_cache_warm: true,
  cache_ttl: '5m',
  estimated_cache_write_usd: 0,
  pricing: 'catalog',
} as const

function seed(on: On, patch: Partial<Snapshot> = {}, shape = 'snapshot-2') {
  on('clock.now', () => ({ value: AT }))
  on('state.get', (_, e) =>
    e.key === 'snapshot'
      ? { value: { value: { shape, value: { ...SNAPSHOT, ...patch } }, version: 1 } }
      : { value: { value: AT, version: 1 } },
  )
}

function engine(on: On, usage: () => SessionUsage, theme = 'dark') {
  on('session.usage', () => ({ value: usage() }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('config.list', () => ({
    value: [
      { key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false },
    ],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  return mock.clock(on, { now: AT })
}

test('model and token labels', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-5-5-20261001')).toBe('Sonnet 5.5')
  expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(modelLabel('gpt-whatever')).toBe('gpt-whatever')
  expect(tokenLabel(48000)).toBe('48k')
  expect(tokenLabel(5300)).toBe('5.3k')
  expect(tokenLabel(1000000)).toBe('1M')
  expect(tokenLabel(715000)).toBe('715k')
})

test('layout A draws every pill with the defaults', async ($, on) => {
  seed(on)
  const ui = await $.ui.mount(BAND)

  for (const text of [/Opus 5\.5/, /xhigh/, /4\.8%/, /\(48k\/1M\)/, /\+5\.3k/, /22%/, /━━╍╍━━━━━━/, /35%/, /3d14h/, /98%/, /54m/, /≈ \$1\.84/, /\+\$0\.12/]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.unmount()
})

test('cache and cost can be hidden', { options: { showCache: false, showCost: false } }, async ($, on) => {
  seed(on)
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /4\.8%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.84/ })).toBeUndefined()
  await ui.unmount()
})

test('a stored block bar style falls back to auto', { options: { layout: 'B', barStyle: 'block' } }, async ($, on) => {
  seed(on)
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /▰▰▱▱▱▱▱▱▱▱/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /╱/ })).toBeUndefined()
  await ui.unmount()
})

test('layout B uses the segment bar by default', { options: { layout: 'B' } }, async ($, on) => {
  seed(on)
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /▰▰▱▱▱▱▱▱▱▱/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /54m/ })).toBeDefined()
  await ui.unmount()
})

const TONES: readonly (readonly [string, Partial<Snapshot>, RegExp, string])[] = [
  ['a slow window stays calm', {}, /^22%$/, FG],
  ['a fast 5h window turns amber', { fiveHour: { percentUsed: 58, resetsAt: AT + 3 * HOUR } }, /^58%$/, AMBER],
  ['a nearly spent window turns red even at its start', { fiveHour: { percentUsed: 95, resetsAt: AT + 299 * MINUTE } }, /^95%$/, RED],
  ['context past 60% turns amber', { contextTokens: 715000 }, /^71\.5%$/, AMBER],
  ['context past 85% turns red', { contextTokens: 926000 }, /^92\.6%$/, RED],
  ['a low cache hit rate turns amber', { cacheHit: 0.64 }, /^64%$/, AMBER],
  ['a cache about to lapse turns amber', { lastResponseAt: AT - 55 * MINUTE }, /^5m$/, AMBER],
  ['a lapsed cache turns red', { lastResponseAt: AT - 2 * HOUR }, /^expired$/, RED],
  ['a 5 minute cache about to lapse turns amber', { fiveHour: null, sevenDay: null, lastResponseAt: AT - 4.5 * MINUTE }, /^1m$/, AMBER],
  ['a lapsed 5 minute cache turns red', { fiveHour: null, sevenDay: null, lastResponseAt: AT - 6 * MINUTE }, /^expired$/, RED],
]

for (const [name, patch, text, color] of TONES) {
  test(name, async ($, on) => {
    seed(on, patch)
    const ui = await $.ui.mount(BAND)

    expect((await ui.find({ type: 'Text', text }))?.props.color).toBe(color)
    await ui.unmount()
  })
}

test('a window past its reset reads as empty', async ($, on) => {
  seed(on, { fiveHour: { percentUsed: 95, resetsAt: AT - HOUR } })
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /^0%$/ }))?.props.color).toBe(FG)
  expect(await ui.find({ type: 'Text', text: /95%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /0h00/ })).toBeUndefined()
  await ui.unmount()
})

test('the first 10% of a window does not warn', async ($, on) => {
  seed(on, { sevenDay: { percentUsed: 20, resetsAt: AT + 0.91 * 168 * HOUR } })
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /^20%$/ }))?.props.color).toBe(FG)
  expect(await ui.find({ type: 'Text', text: /6d9h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚠/ })).toBeUndefined()
  await ui.unmount()
})

test('past 10% a fast 7d window warns when it runs out', async ($, on) => {
  seed(on, { sevenDay: { percentUsed: 50, resetsAt: AT + 126 * HOUR } })
  const ui = await $.ui.mount(BAND)
  const out = new Date(AT + 42 * HOUR)
  const warn = `⚠ out ${out.toDateString().slice(0, 3)} ${out.toTimeString().slice(0, 5)}`

  expect((await ui.find({ type: 'Text', text: /^50%$/ }))?.props.color).toBe(AMBER)
  expect((await ui.find({ type: 'Text', text: /^⚠/ }))?.text).toBe(warn)
  expect((await ui.find({ type: 'Text', text: /^⚠/ }))?.props.color).toBe(AMBER)
  expect(await ui.find({ type: 'Text', text: /5d6h/ })).toBeUndefined()
  await ui.unmount()
})

test('a fast 5h window keeps its reset time', async ($, on) => {
  seed(on, { fiveHour: { percentUsed: 58, resetsAt: AT + 3 * HOUR } })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /3h00/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚠/ })).toBeUndefined()
  await ui.unmount()
})

test('context past 85% asks for a compact in place of the spark', async ($, on) => {
  seed(on, { contextTokens: 926000 })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /compact soon/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▲/ })).toBeUndefined()
  await ui.unmount()
})

const SPARKS: readonly (readonly [string, number[], RegExp])[] = [
  ['the spark scales to the largest growth', [1900, 600, 3600, 400, 5300], /▃▁▅▁█ ▲ \+5\.3k/],
  ['a compaction does not flatten the spark', [1900, 600, 3600, 400, -150000], /▄▁█▁▁ ▼ -150k/],
  ['a spark of only shrinking turns draws flat', [-5000, -150000], /▁▁ ▼ -150k/],
]

for (const [name, deltas, text] of SPARKS) {
  test(name, async ($, on) => {
    seed(on, { deltas })
    const ui = await $.ui.mount(BAND)

    expect(await ui.find({ type: 'Text', text })).toBeDefined()
    await ui.unmount()
  })
}

test('session.start reads the usage, the model and the theme', async ($, on) => {
  engine(on, () => USAGE, 'light')
  await $.session.start(START)
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.props.color).toBe(LIGHT_FG)
  for (const text of [/4\.8%/, /^22%$/, /3h00/, /^35%$/, /≈ \$1\.00/]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.unmount()
})

test('a finished turn records growth, cost and the cache', async ($, on) => {
  let usage = USAGE
  engine(on, () => usage)
  await $.session.start(START)
  usage = { ...USAGE, context: { tokens: 53300, window: 1000000 }, cost: { usd: 1.12 } }
  await $.turn.complete(TURN)
  const ui = await $.ui.mount(BAND)

  for (const text of [/5\.3%/, /▲ \+5\.3k/, /≈ \$1\.12/, /\+\$0\.12/, /^98%$/, /^60m$/]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.unmount()
})

test('a subagent turn records nothing', async ($, on) => {
  let usage = USAGE
  engine(on, () => usage)
  await $.session.start(START)
  usage = { ...USAGE, context: { tokens: 53300, window: 1000000 } }
  await $.turn.complete({ ...TURN, agentId: 'a1' })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /4\.8%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▲/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
  await ui.unmount()
})

test('session.measure updates the context and keeps an unreported window', async ($, on) => {
  engine(on, () => USAGE)
  await $.session.start(START)
  await $.session.measure({ context: { tokens: 715000, window: 1000000 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /^71\.5%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^22%$/ })).toBeDefined()
  await ui.unmount()
})

test('turn.step records the effort of the main thread alone', async ($, on) => {
  engine(on, () => USAGE)
  await $.session.start(START)
  await $.turn.step({ ...STEP, effort: 'max', agentId: 'a1' }).next()
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /^max$/ })).toBeUndefined()
  await $.turn.step({ ...STEP, effort: 'high' }).next()
  expect(await ui.find({ type: 'Text', text: /^high$/ })).toBeDefined()
  await ui.unmount()
})

const TTLS: readonly (readonly [string, Partial<Snapshot>, RegExp])[] = [
  ['off a subscription the cache lasts 5 minutes', { fiveHour: null, sevenDay: null, lastResponseAt: AT - MINUTE }, /^4m$/],
  ['an exhausted window drops the cache to 5 minutes', { fiveHour: { percentUsed: 100, resetsAt: AT + HOUR }, lastResponseAt: AT - MINUTE }, /^4m$/],
  ['an exhausted window beats a reported 1 hour', { cacheTtl: '1h', sevenDay: { percentUsed: 100, resetsAt: AT + HOUR }, lastResponseAt: AT - MINUTE }, /^4m$/],
  ['a reported 1 hour beats the guess off a subscription', { cacheTtl: '1h', fiveHour: null, sevenDay: null, lastResponseAt: AT - 6 * MINUTE }, /^54m$/],
  ['a reported 5 minutes beats the guess on a subscription', { cacheTtl: '5m', lastResponseAt: AT - MINUTE }, /^4m$/],
]

for (const [name, patch, text] of TTLS) {
  test(name, async ($, on) => {
    seed(on, patch)
    const ui = await $.ui.mount(BAND)

    expect(await ui.find({ type: 'Text', text })).toBeDefined()
    await ui.unmount()
  })
}

test('a snapshot an earlier version stored is declined', async ($, on) => {
  seed(on, {}, 'snapshot-1')
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  await ui.unmount()
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`${source} starts the band over from the live figures`, async ($, on) => {
    let usage = USAGE
    engine(on, () => usage, 'light')
    await $.session.start(START)
    usage = { ...USAGE, context: { tokens: 53300, window: 1000000 }, cost: { usd: 1.12 } }
    await $.turn.complete(TURN)
    await $.classic.PostModelSwitch(SWITCH)
    await $.classic.SessionStart({ source })
    const ui = await $.ui.mount(BAND)

    expect((await ui.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.props.color).toBe(LIGHT_FG)
    for (const text of [/5\.3%/, /^22%$/, /≈ \$1\.12/]) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    for (const text of [/▲/, /\+\$/, /cache/]) {
      expect(await ui.find({ type: 'Text', text })).toBeUndefined()
    }
    await ui.unmount()
  })
}

test('a compaction keeps the band', async ($, on) => {
  let usage = USAGE
  engine(on, () => usage)
  await $.session.start(START)
  usage = { ...USAGE, context: { tokens: 53300, window: 1000000 } }
  await $.turn.complete(TURN)
  await $.classic.SessionStart({ source: 'compact' })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /▲ \+5\.3k/ })).toBeDefined()
  await ui.unmount()
})

test('a model switch updates the model and the cache at once', async ($, on) => {
  engine(on, () => USAGE)
  await $.session.start(START)
  await $.turn.complete(TURN)
  await $.classic.PostModelSwitch(SWITCH)
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /^Sonnet 5\.5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^5m$/ })).toBeDefined()
  await ui.unmount()
})

test('the timer redraws a band whose cache has lapsed', async ($, on) => {
  const clock = engine(on, () => USAGE)
  await $.session.start(START)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /^60m$/ })).toBeDefined()
  await clock.advance(61 * MINUTE)
  expect(await ui.find({ type: 'Text', text: /^expired$/ })).toBeDefined()
  await ui.unmount()
})
