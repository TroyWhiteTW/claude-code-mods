import { expect, test } from 'claude-code/testing'

import { modelLabel, tokenLabel } from '../hooks/register'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const AT = Date.parse('2026-11-01T10:00:00Z')

const SNAPSHOT = {
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

function seed(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('clock.now', () => ({ value: AT }))
  on('state.get', (_, e) =>
    e.key === 'snapshot'
      ? { value: { value: { shape: 'snapshot-1', value: SNAPSHOT }, version: 1 } }
      : { value: { value: AT, version: 1 } },
  )
}

test('model and token labels', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-5-5-20261001')).toBe('Sonnet 5.5')
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
