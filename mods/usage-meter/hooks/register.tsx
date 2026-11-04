import { atom, read, update } from 'claude-code'
import type { ConfigRow, ConfigValue, EngineInterface, PluginOptions, Register, SessionRateLimit, SessionUsage, TurnUsage } from 'claude-code'

import type { CacheTtl, Limit, Snapshot } from '../types'

type Tone = 'ok' | 'amber' | 'red'
type BarStyle = 'line' | 'segment'
type PillColors = { border: string; fill: string; solid: string; icon: string }
type Hue = 'model' | 'ctx' | 'fiveHour' | 'sevenDay' | 'cache' | 'cost' | 'amber' | 'red'
type Palette = {
  fg: string
  dim: string
  sep: string
  track: string
  trackSolid: string
  pace: string
  spark: string
  green: string
  amber: string
  red: string
  pill: Record<Hue, PillColors>
}
type Seg = { text: string; color?: string; bold?: boolean }
type Pill = { colors: PillColors; segs: Seg[] }
type Settings = { layout: 'A' | 'B'; barStyle: BarStyle; showCache: boolean; showCost: boolean }

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const FIVE_HOURS = 5 * HOUR
const SEVEN_DAYS = 7 * 24 * HOUR
const CACHE_TTL: Record<CacheTtl, { life: number; warn: number }> = {
  '5m': { life: 5 * MINUTE, warn: MINUTE },
  '1h': { life: HOUR, warn: 10 * MINUTE },
}
const CACHE_HIT_LOW = 0.9
const CONTEXT_AMBER = 60
const CONTEXT_RED = 85
const LIMIT_RED = 90
const PACE_WARN_AFTER = 0.1
const SPARK_SIZE = 5
const BAR_CELLS = 10

const DARK: Palette = {
  fg: '#d9dbe0',
  dim: '#80858f',
  sep: '#4b4f59',
  track: '#353943',
  trackSolid: '#5a5f6a',
  pace: '#8c929d',
  spark: '#7d838e',
  green: '#4fc583',
  amber: '#e2b340',
  red: '#f07068',
  pill: {
    model: { border: '#5f636d', fill: '#1d1e23', solid: '#2a2c33', icon: '#d97757' },
    ctx: { border: '#5269b8', fill: '#1b2133', solid: '#24304d', icon: '#e2b340' },
    fiveHour: { border: '#3a8a5f', fill: '#18271f', solid: '#1f3a2c', icon: '#4fc583' },
    sevenDay: { border: '#7560bf', fill: '#221d33', solid: '#322a4d', icon: '#a58cf0' },
    cache: { border: '#2c89a1', fill: '#16282e', solid: '#1c3940', icon: '#4cc3e0' },
    cost: { border: '#9c7b2b', fill: '#28231a', solid: '#3b3220', icon: '#e2b340' },
    amber: { border: '#a8832c', fill: '#2a2418', solid: '#3d3320', icon: '#e2b340' },
    red: { border: '#b04a45', fill: '#2c1a1b', solid: '#432426', icon: '#f07068' },
  },
}

const LIGHT: Palette = {
  fg: '#1f2328',
  dim: '#7b8089',
  sep: '#c3c6cc',
  track: '#d3d6db',
  trackSolid: '#a9aeb6',
  pace: '#8f959e',
  spark: '#a3a8b0',
  green: '#2e9b5d',
  amber: '#c48a12',
  red: '#d4473f',
  pill: {
    model: { border: '#c9cbd0', fill: '#f1f1ef', solid: '#e7e7e4', icon: '#c96442' },
    ctx: { border: '#a8b7ea', fill: '#e9eefc', solid: '#dfe6fa', icon: '#d9a21b' },
    fiveHour: { border: '#9dcfb0', fill: '#e5f3ea', solid: '#d8eedf', icon: '#2e9b5d' },
    sevenDay: { border: '#c3b2ee', fill: '#efeafc', solid: '#e6defa', icon: '#8466dc' },
    cache: { border: '#94cfdf', fill: '#e3f3f7', solid: '#d5edf3', icon: '#2399bb' },
    cost: { border: '#e0c47f', fill: '#f8f0dc', solid: '#f3e6c6', icon: '#c48a12' },
    amber: { border: '#e0c47f', fill: '#f8f0dc', solid: '#f3e6c6', icon: '#c48a12' },
    red: { border: '#eba7a2', fill: '#fbe9e7', solid: '#f7d9d6', icon: '#d4473f' },
  },
}

const EMPTY: Snapshot = {
  model: null,
  effort: null,
  isLight: false,
  contextTokens: null,
  contextWindow: null,
  baseTokens: null,
  baseCost: null,
  deltas: [],
  fiveHour: null,
  sevenDay: null,
  cacheHit: null,
  lastResponseAt: null,
  cacheTtl: null,
  costUsd: null,
  lastCostUsd: null,
}

const snapshot = atom({ plugin: 'usage-meter', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-2' })

function readSettings(options: PluginOptions): Settings {
  const layout = options.layout === 'B' ? 'B' : 'A'
  const style = options.barStyle
  const barStyle: BarStyle = style === 'line' || style === 'segment' ? style : layout === 'A' ? 'line' : 'segment'

  return { layout, barStyle, showCache: options.showCache !== false, showCost: options.showCost !== false }
}

function toLimit(list: readonly SessionRateLimit[], kind: string): Limit | null {
  const found = list.find(limit => limit.kind === kind)
  if (found === undefined) {
    return null
  }
  const resetsAt = found.resetsAt === undefined ? NaN : Date.parse(found.resetsAt)

  return { percentUsed: found.percentUsed, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
}

function withUsage(s: Snapshot, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Snapshot {
  return {
    ...s,
    contextTokens: usage.context.tokens ?? null,
    contextWindow: usage.context.window,
    fiveHour: toLimit(usage.rateLimits, 'five_hour') ?? s.fiveHour,
    sevenDay: toLimit(usage.rateLimits, 'seven_day') ?? s.sevenDay,
    costUsd: usage.cost?.usd ?? s.costUsd,
  }
}

function hitRate(usage: TurnUsage | undefined): number | null {
  if (usage === undefined) {
    return null
  }
  const total = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

  return total === 0 ? null : usage.cache_read_input_tokens / total
}

export function modelLabel(raw: string): string {
  const id = raw.replace(/\[[^\]]*\]$/, '').trim()
  const [, name, major, minor] = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/i.exec(id) ?? []
  if (name === undefined) {
    return id
  }
  const family = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()

  return minor === undefined ? `${family} ${major}` : `${family} ${major}.${minor}`
}

export function tokenLabel(n: number): string {
  const abs = Math.abs(n)
  const short = (value: number) => (Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10)

  return abs >= 1000000 ? `${short(n / 1000000)}M` : abs >= 1000 ? `${short(n / 1000)}k` : String(Math.round(n))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function clockLabel(at: number): string {
  const d = new Date(at)

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function hoursLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE))

  return `${Math.floor(minutes / 60)}h${pad(minutes % 60)}`
}

function daysLabel(ms: number): string {
  const hours = Math.max(0, Math.round(ms / HOUR))

  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

function toneColor(p: Palette, tone: Tone): string {
  return tone === 'red' ? p.red : tone === 'amber' ? p.amber : p.green
}

function toneText(p: Palette, tone: Tone): string {
  return tone === 'ok' ? p.fg : toneColor(p, tone)
}

function pillColors(p: Palette, hue: Hue, tone: Tone): PillColors {
  return tone === 'ok' ? p.pill[hue] : p.pill[tone]
}

function sep(p: Palette): Seg[] {
  return [{ text: ' ' }, { text: '│', color: p.sep }, { text: ' ' }]
}

function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const seg of segs) {
    const last = out[out.length - 1]
    if (last !== undefined && last.color === seg.color && last.bold === seg.bold) {
      out[out.length - 1] = { ...last, text: last.text + seg.text }
    } else {
      out.push(seg)
    }
  }

  return out
}

function bar(p: Palette, used: number, pace: number, style: BarStyle, color: string): Seg[] {
  const solidEnd = Math.min(used, pace) * BAR_CELLS
  const hatchEnd = Math.max(used, pace) * BAR_CELLS
  const hatch = used > pace ? color : p.pace
  const segs: Seg[] = []
  for (let i = 0; i < BAR_CELLS; i++) {
    const center = i + 0.5
    if (style === 'line') {
      segs.push(
        center < solidEnd
          ? { text: '━', color }
          : center < hatchEnd
            ? { text: '╍', color: hatch }
            : { text: '━', color: p.track },
      )
    } else {
      segs.push(center < solidEnd ? { text: '▰', color } : { text: '▱', color: center < hatchEnd ? hatch : p.track })
    }
  }

  return merge(segs)
}

function modelPill(s: Snapshot, p: Palette): Pill | null {
  if (s.model === null) {
    return null
  }
  const colors = p.pill.model
  const segs: Seg[] = [{ text: '✻', color: colors.icon }, { text: ' ' }, { text: modelLabel(s.model), color: p.fg, bold: true }]
  if (s.effort !== null) {
    segs.push({ text: ' ' }, { text: s.effort, color: p.dim })
  }

  return { colors, segs }
}

function contextPill(s: Snapshot, p: Palette): Pill | null {
  if (s.contextWindow === null || s.contextWindow === 0) {
    return null
  }
  const percent = s.contextTokens === null ? null : (s.contextTokens / s.contextWindow) * 100
  const tone: Tone = percent === null ? 'ok' : percent >= CONTEXT_RED ? 'red' : percent >= CONTEXT_AMBER ? 'amber' : 'ok'
  const colors = pillColors(p, 'ctx', tone)
  const icon = tone === 'red' ? '⛈' : tone === 'amber' ? '☁' : '☀'
  const used = s.contextTokens === null ? '–' : tokenLabel(s.contextTokens)
  const segs: Seg[] = [
    { text: icon, color: colors.icon },
    { text: ' ' },
    { text: percent === null ? '–' : `${percent.toFixed(1)}%`, color: toneText(p, tone), bold: true },
    { text: ' ' },
    { text: `(${used}/${tokenLabel(s.contextWindow)})`, color: p.dim },
  ]
  if (tone === 'red') {
    return { colors, segs: [...segs, ...sep(p), { text: 'compact soon', color: p.red }] }
  }
  const last = s.deltas.at(-1)
  if (last === undefined) {
    return { colors, segs }
  }

  const levels = '▁▂▃▄▅▆▇█'
  const max = Math.max(...s.deltas)
  const spark: Seg[] = s.deltas.map((delta, i) => ({
    text: levels.charAt(delta > 0 ? Math.max(0, Math.round((delta / max) * 8) - 1) : 0),
    color: i === s.deltas.length - 1 ? p.amber : p.spark,
  }))
  const deltaText = last >= 0 ? `▲ +${tokenLabel(last)}` : `▼ ${tokenLabel(last)}`

  return { colors, segs: [...segs, ...sep(p), ...spark, { text: ' ' }, { text: deltaText, color: p.dim }] }
}

function limitPill(
  limit: Limit | null,
  label: string,
  icon: string,
  hue: Hue,
  windowMs: number,
  p: Palette,
  style: BarStyle,
  at: number,
): Pill | null {
  if (limit === null) {
    return null
  }
  const left = limit.resetsAt === null ? null : limit.resetsAt - at
  const hasReset = left !== null && left <= 0
  const percent = hasReset ? 0 : limit.percentUsed
  const used = percent / 100
  const pace = left === null || hasReset ? used : Math.max(0, Math.min(1, 1 - left / windowMs))
  const isAhead = used > pace && pace >= PACE_WARN_AFTER
  const tone: Tone = percent >= LIMIT_RED ? 'red' : isAhead ? 'amber' : 'ok'
  const colors = pillColors(p, hue, tone)
  const segs: Seg[] = [
    { text: icon, color: colors.icon },
    { text: ' ' },
    { text: label, color: p.fg },
    { text: ' ' },
    ...bar(p, used, pace, style, toneColor(p, tone)),
    { text: ' ' },
    { text: `${Math.round(percent)}%`, color: toneText(p, tone), bold: true },
  ]
  if (left === null || hasReset || limit.resetsAt === null) {
    return { colors, segs }
  }

  if (windowMs === SEVEN_DAYS && isAhead && percent < 100) {
    const outAt = at + ((100 - percent) / percent) * pace * windowMs
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(outAt).getDay()]
    const warn = `⚠ out ${day} ${clockLabel(outAt)}`

    return { colors, segs: [...segs, ...sep(p), { text: warn, color: toneColor(p, tone) }] }
  }

  const reset = windowMs === FIVE_HOURS ? `${hoursLabel(left)} → ${clockLabel(limit.resetsAt)}` : daysLabel(left)

  return { colors, segs: [...segs, ...sep(p), { text: '↻', color: colors.icon }, { text: ' ' }, { text: reset, color: p.dim }] }
}

function cacheTtlOf(s: Snapshot): CacheTtl {
  const limits = [s.fiveHour, s.sevenDay].filter((limit): limit is Limit => limit !== null)
  if (limits.some(limit => limit.percentUsed >= 100)) {
    return '5m'
  }

  return s.cacheTtl ?? (limits.length > 0 ? '1h' : '5m')
}

function cachePill(s: Snapshot, p: Palette, at: number): Pill | null {
  if (s.lastResponseAt === null) {
    return null
  }
  const { life, warn } = CACHE_TTL[cacheTtlOf(s)]
  const left = s.lastResponseAt + life - at
  const tone: Tone = left <= 0 ? 'red' : left < warn ? 'amber' : 'ok'
  const colors = pillColors(p, 'cache', tone)
  const segs: Seg[] = [{ text: '↯', color: colors.icon }, { text: ' ' }, { text: 'cache', color: p.fg }]
  if (s.cacheHit !== null) {
    const color = s.cacheHit < CACHE_HIT_LOW ? p.amber : p.fg
    segs.push({ text: ' ' }, { text: `${Math.round(s.cacheHit * 100)}%`, color, bold: true })
  }
  const ttl: Seg =
    left <= 0
      ? { text: 'expired', color: p.red, bold: true }
      : { text: `${Math.ceil(left / MINUTE)}m`, color: tone === 'amber' ? p.amber : p.dim }

  return { colors, segs: [...segs, ...sep(p), ttl] }
}

function costPill(s: Snapshot, p: Palette): Pill | null {
  if (s.costUsd === null) {
    return null
  }
  const colors = p.pill.cost
  const segs: Seg[] = [
    { text: '$', color: colors.icon, bold: true },
    { text: ' ' },
    { text: `≈ $${s.costUsd.toFixed(2)}`, color: p.fg, bold: true },
  ]
  if (s.lastCostUsd === null) {
    return { colors, segs }
  }

  return {
    colors,
    segs: [...segs, ...sep(p), { text: '↳', color: colors.icon }, { text: ' ' }, { text: `+$${s.lastCostUsd.toFixed(2)}`, color: p.dim }],
  }
}

function pills(s: Snapshot, settings: Settings, at: number): Pill[] {
  const base = s.isLight ? LIGHT : DARK
  // 版面 B 的底色跟一般的 track 太接近，空格會看不見
  const p = settings.layout === 'B' ? { ...base, track: base.trackSolid } : base
  const list = [
    modelPill(s, p),
    contextPill(s, p),
    limitPill(s.fiveHour, '5h', '◔', 'fiveHour', FIVE_HOURS, p, settings.barStyle, at),
    limitPill(s.sevenDay, '7d', '▦', 'sevenDay', SEVEN_DAYS, p, settings.barStyle, at),
    settings.showCache ? cachePill(s, p, at) : null,
    settings.showCost ? costPill(s, p) : null,
  ]

  return list.filter((pill): pill is Pill => pill !== null)
}

function themeRow(rows: readonly ConfigRow[]): ConfigValue | undefined {
  return rows.find(row => row.key === 'theme')?.value
}

function isLightTheme(theme: ConfigValue | undefined): boolean {
  return typeof theme === 'string' && theme.includes('light')
}

async function syncTheme($: EngineInterface, theme: ConfigValue | undefined): Promise<void> {
  const isLight = isLightTheme(theme)
  if ((await read($, snapshot)).isLight !== isLight) {
    await update($, snapshot, s => ({ ...s, isLight }))
  }
}

async function load($: EngineInterface, base?: Snapshot): Promise<void> {
  const [usage, model, rows] = await Promise.all([$.session.usage(), $.session.model(), $.config.list()])
  await update($, snapshot, s => {
    const live = withUsage(base ?? s, usage)

    return {
      ...live,
      model,
      isLight: isLightTheme(themeRow(rows)),
      baseTokens: live.baseTokens ?? live.contextTokens,
      baseCost: live.baseCost ?? live.costUsd,
    }
  })
}

export const register: Register = (on, options) => {
  const settings = readSettings(options)

  on('session.start', async ($, e, next) => {
    await load($)
    $.clock.every(30 * 1000, () => {
      $.ui.invalidate('ui.render')
      void $.config.list().then(rows => syncTheme($, themeRow(rows)))
    })

    return next(e)
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    // 剛寫入時 $.config.list() 還是舊值，所以用 next(e) 回傳的值
    if ('value' in result) {
      await syncTheme($, result.value)
    }

    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      await load($, EMPTY)
    }

    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    await update($, snapshot, s => ({ ...s, model: e.to_model, cacheTtl: e.cache_ttl }))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, s => withUsage(s, e))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      const effort = String(e.effort)
      if ((await read($, snapshot)).effort !== effort) {
        await update($, snapshot, s => ({ ...s, effort }))
      }
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const [usage, model, at] = await Promise.all([$.session.usage(), $.session.model(), $.clock.now()])
      await update($, snapshot, s => {
        const live = withUsage(s, usage)
        const tokens = live.contextTokens
        const cost = live.costUsd
        const delta = tokens !== null && s.baseTokens !== null ? tokens - s.baseTokens : 0

        return {
          ...live,
          model,
          deltas: delta === 0 ? s.deltas : [...s.deltas, delta].slice(-SPARK_SIZE),
          baseTokens: tokens ?? s.baseTokens,
          baseCost: cost ?? s.baseCost,
          lastCostUsd: cost !== null && s.baseCost !== null ? cost - s.baseCost : s.lastCostUsd,
          cacheHit: hitRate(e.usage) ?? s.cacheHit,
          lastResponseAt: e.usage === undefined ? s.lastResponseAt : at,
        }
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const s = await read($, snapshot)
    const list = pills(s, settings, await $.clock.now())
    if (list.length === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const draw = (pill: Pill) => {
      const isFramed = settings.layout === 'A'
      const bg = isFramed ? pill.colors.fill : pill.colors.solid
      const frame = isFramed ? ({ borderStyle: 'round', borderColor: pill.colors.border } as const) : {}

      return (
        <Box {...frame} backgroundColor={bg} paddingX={1}>
          <Text>
            {pill.segs.map(seg => (
              <Text color={seg.color} bold={seg.bold} backgroundColor={bg}>
                {seg.text}
              </Text>
            ))}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {list.map(draw)}
      </Box>
    )
  })
}
