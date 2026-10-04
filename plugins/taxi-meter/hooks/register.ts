import type { Register } from 'claude-code'

type Tier = '일반' | '모범' | '블랙'
type Limit = { kind: string; percentUsed: number; resetsAt?: string }
type Ledger = { since: string; totalUsd: number; days: Record<string, number> }
type Line = { text: string; color?: string; bold?: boolean; dim?: boolean }

const RECEIPT = 'taxi-receipt'
const TICK = 'sounds/tick.wav'
const CHIME = 'sounds/chime.wav'
const LEDGER = 'ledger'
const TRACK = 10
const LONG_HAUL_PERCENT = 50
const LEDGER_DAYS = 90
const DAY_MS = 86_400_000

const RED = '#ff3b30'
const YELLOW = '#ffcc00'
const GREEN = '#34c759'
const DEFAULT_COLOR = 0x01000000
const LED_ON = 0xff3b30
const LED_OFF = 0x2a0907

const FONT: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ',': ['0', '0', '0', '1', '1'],
}

const TIER_COLOR: Record<Tier, string> = { 일반: 'gray', 모범: YELLOW, 블랙: 'white' }

const positive = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

const comma = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const pad = (n: number) => String(n).padStart(2, '0')

const clockOfMs = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const clockOf = (iso?: string) => {
  const ms = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(ms) ? undefined : clockOfMs(ms)
}

const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const monthDay = (iso: string) => {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '처음'
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const duration = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`
}

const tierOf = (model?: string): Tier | undefined => {
  if (!model) return undefined
  if (/fable/i.test(model)) return '블랙'
  if (/opus/i.test(model)) return '모범'
  return '일반'
}

const isLedger = (value: unknown): value is Ledger =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Ledger).totalUsd === 'number' &&
  typeof (value as Ledger).since === 'string' &&
  typeof (value as Ledger).days === 'object'

const credit = (ledger: Ledger, now: number, usd: number): Ledger => {
  const day = dayKey(now)
  const days = Object.fromEntries(
    Object.entries({ ...ledger.days, [day]: (ledger.days[day] ?? 0) + usd })
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-LEDGER_DAYS),
  )
  return { since: ledger.since || new Date(now).toISOString(), totalUsd: ledger.totalUsd + usd, days }
}

const base64 = (bytes: Uint8Array) => {
  const native = bytes as Uint8Array & { toBase64?: () => string }
  if (native.toBase64) return native.toBase64()
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const ledDigits = (text: string) => {
  const columns: string[] = ['00000']
  for (const char of text) {
    const glyph = FONT[char]
    if (!glyph) continue
    for (let x = 0; x < glyph[0].length; x++) columns.push(glyph.map((row) => row[x]).join(''))
    columns.push('00000')
  }
  const rows = 3
  const numbers: number[] = []
  for (let y = 0; y < rows; y++) {
    for (const column of columns) {
      const top = column[y * 2] === '1'
      const bottom = column[y * 2 + 1] === '1'
      const char = top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
      numbers.push(char.codePointAt(0) ?? 32, top || bottom ? LED_ON : DEFAULT_COLOR, LED_OFF)
    }
  }
  return { columns: columns.length, rows, cells: base64(new Uint8Array(Uint32Array.from(numbers).buffer)) }
}

export const register: Register = (on, options) => {
  const rate = positive(options.krw_per_usd, 1400)
  const style = options.style === 'compact' ? 'compact' : 'led'
  const sound = options.sound !== false
  const tickWon = positive(options.tick_won, 1000)

  let startedAt = 0
  let seededUsd = 0
  let costUsd = 0
  let limits: Limit[] = []
  let contextPercent: number | undefined
  let model: string | undefined
  let frame = 0
  let ticks = 0
  let warned = 0
  let longHaul = false
  let longHaulCount = 0
  let peakFiveHour = 0
  let tokens = 0
  const tokensByTier: Record<Tier, number> = { 일반: 0, 모범: 0, 블랙: 0 }
  let ledger: Ledger = { since: '', totalUsd: 0, days: {} }
  let timer: { cancel: () => void } | undefined

  const tripUsd = () => Math.max(0, costUsd - seededUsd)
  const fare = (usd: number) => Math.round((usd * rate) / 10) * 10
  const won = (usd: number) => `₩${comma(fare(usd))}`
  const limitOf = (kind: string) => limits.find((limit) => limit.kind === kind)

  const recentUsd = (now: number, days: number) => {
    let sum = 0
    for (let i = 0; i < days; i++) sum += ledger.days[dayKey(now - i * DAY_MS)] ?? 0
    return sum
  }

  const status = (isWorking: boolean): Line => {
    const five = limitOf('five_hour')
    if (five && five.percentUsed >= 100) return { text: '[하차]', color: RED, bold: true }
    if (isWorking) return { text: '[주행]', color: GREEN, bold: true }
    if (tripUsd() === 0) return { text: '[빈차]', color: RED, bold: true }
    return { text: '[대기]', color: YELLOW }
  }

  const lamps = (isWorking: boolean): Line[] => {
    const tier = tierOf(model)
    return [
      status(isWorking),
      ...(tier ? [{ text: `[${tier}]`, color: TIER_COLOR[tier], bold: tier !== '일반' }] : []),
      ...(longHaul ? [{ text: '[장거리]', color: 'cyan' }] : []),
    ]
  }

  const limitLine = (): Line => {
    const five = limitOf('five_hour')
    const week = limitOf('seven_day')
    const credit = limitOf('spend_limit')
    if (!five && !week && !credit) return { text: '한도는 첫 응답 뒤에 표시돼요', dim: true }
    const reset = clockOf(five?.resetsAt)
    if (five && five.percentUsed >= 100) {
      return { text: `하차하셔야 합니다${reset ? ` · ${reset} 재승차` : ''}`, color: RED, bold: true }
    }
    const text = [
      five ? `5시간 ${five.percentUsed}%${reset ? ` · ${reset} 리셋` : ''}` : undefined,
      week ? `주간 ${week.percentUsed}%` : undefined,
      credit ? `크레딧 한도 ${credit.percentUsed}%` : undefined,
    ]
      .filter((part) => part !== undefined)
      .join(' │ ')
    if (five && five.percentUsed >= 90) return { text: `곧 목적지입니다 · ${text}`, color: YELLOW, bold: true }
    return { text }
  }

  const track = () => {
    const horse = TRACK - 1 - (frame % TRACK)
    return Array.from({ length: TRACK }, (_, i) => (i === horse ? '🐎' : '·')).join('')
  }

  const report = (now: number) => {
    const five = limitOf('five_hour')
    const week = limitOf('seven_day')
    return [
      '🚕 클로드 택시 미터기',
      `이번 승차 ${won(tripUsd())} (API 정가 환산 $${tripUsd().toFixed(2)} · 환율 ${comma(rate)}원)`,
      `오늘 ${won(recentUsd(now, 1))} · 최근 7일 ${won(recentUsd(now, 7))} · ${monthDay(ledger.since)}부터 ${won(ledger.totalUsd)}`,
      five || week ? limitLine().text : '한도: 아직 응답이 없어요',
      `차종 ${tierOf(model) ?? '-'}${model ? ` (${model})` : ''} · 컨텍스트 ${contextPercent === undefined ? '-' : `${contextPercent}%`}`,
    ].join('\n')
  }

  const shares = () => {
    const total = tokens || 1
    const parts = (Object.entries(tokensByTier) as [Tier, number][])
      .filter(([, n]) => n > 0)
      .map(([tier, n]) => `${tier} ${Math.round((n / total) * 100)}%`)
    return parts.length > 0 ? parts.join(' · ') : '-'
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'meter',
      description: '택시 미터기: 이번 승차·오늘·누적 요금과 한도 (meter reset은 누적 초기화)',
      argumentHint: '[reset]',
      immediate: true,
    })
    await $.command.register({ name: 'receipt', description: '택시 영수증 열기', immediate: true })
    const now = await $.clock.now()
    const saved = await $.store.get(LEDGER)
    ledger = isLedger(saved) ? saved : { since: new Date(now).toISOString(), totalUsd: 0, days: {} }
    const usage = await $.session.usage()
    startedAt = usage.startedAt || now
    seededUsd = usage.cost?.usd ?? 0
    costUsd = seededUsd
    limits = [...usage.rateLimits]
    contextPercent = usage.context.percent
    return result
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    timer?.cancel()
    timer = $.clock.every(250, () => {
      frame += 1
      $.ui.invalidate('ui.render')
    })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!(e as { agentId?: string }).agentId) {
      timer?.cancel()
      timer = undefined
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) model = e.model
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      const used =
        (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      tokens += used
      tokensByTier[tierOf(usage.model ?? e.model) ?? '일반'] += used
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    limits = [...e.rateLimits]
    contextPercent = e.context.percent ?? contextPercent
    const isLong = (contextPercent ?? 0) >= LONG_HAUL_PERCENT
    if (isLong && !longHaul) longHaulCount += 1
    longHaul = isLong

    const five = limitOf('five_hour')
    if (five) peakFiveHour = Math.max(peakFiveHour, five.percentUsed)

    if (e.cost && e.cost.usd > costUsd) {
      const delta = e.cost.usd - costUsd
      costUsd = e.cost.usd
      const saved = await $.store.get(LEDGER)
      ledger = credit(isLedger(saved) ? saved : ledger, await $.clock.now(), delta)
      await $.store.set(LEDGER, ledger)
      const step = Math.floor(fare(tripUsd()) / tickWon)
      if (step > ticks) {
        ticks = step
        if (sound) $.audio.play({ asset: TICK }).catch(() => {})
      }
    }

    const level = !five ? 0 : five.percentUsed >= 100 ? 100 : five.percentUsed >= 90 ? 90 : 0
    if (level > warned && sound) $.audio.play({ asset: CHIME }).catch(() => {})
    warned = level

    $.ui.invalidate('ui.render')
    return result
  })

  on('command.run', { command: 'meter' }, async ($, e) => {
    const now = await $.clock.now()
    if (e.args.trim() === 'reset') {
      ledger = { since: new Date(now).toISOString(), totalUsd: 0, days: {} }
      await $.store.set(LEDGER, ledger)
      return { text: '누적 요금을 0원으로 초기화했어요.' }
    }
    return { text: report(now) }
  })

  on('command.run', { command: 'receipt' }, async ($) => {
    await $.ui.open({ id: RECEIPT, title: '영수증', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const text = (line: Line) =>
      Text({
        ...(line.color ? { color: line.color } : {}),
        ...(line.bold ? { bold: true } : {}),
        ...(line.dim ? { dimColor: true } : {}),
        children: [line.text],
      })
    const isWorking = e.props.isWorking
    const lampRow = lamps(isWorking).map(text)
    const limit = text(limitLine())
    const horse = Text({ children: [track()] })

    const meter =
      style === 'led' && e.surface === 'terminal' && 'Raster' in elements
        ? Box({
            flexDirection: 'row',
            columnGap: 2,
            children: [
              elements.Raster({ key: 'fare', ...ledDigits(comma(fare(tripUsd()))) }),
              Box({
                flexDirection: 'column',
                children: [
                  Box({ flexDirection: 'row', columnGap: 1, children: [Text({ dimColor: true, children: ['원 · API 정가 환산'] }), ...lampRow] }),
                  horse,
                  limit,
                ],
              }),
            ],
          })
        : Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [Text({ color: RED, bold: true, children: [won(tripUsd())] }), ...lampRow, horse, limit],
          })

    const below = await next(e)
    return below ? Box({ flexDirection: 'column', children: [meter, below] }) : meter
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== RECEIPT) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const row = (label: string, ...values: ReturnType<typeof Text>[]) =>
      Box({ flexDirection: 'row', columnGap: 1, children: [Box({ width: 7, children: [Text({ dimColor: true, children: [label] })] }), ...values] })
    const plain = (value: string) => Text({ children: [value] })
    const rule = Text({ dimColor: true, children: ['─'.repeat(48)] })
    return Box({
      flexDirection: 'column',
      paddingX: 1,
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [Text({ bold: true, children: ['영  수  증'] }), Text({ dimColor: true, children: [`클로드 택시 · ${dayKey(now)}`] })],
        }),
        rule,
        row('승하차', plain(`${clockOfMs(startedAt)} → ${clockOfMs(now)} (${duration(now - startedAt)})`)),
        row('주행', plain(`${comma(tokens)} 토큰 · ${shares()}`)),
        row(
          '요금',
          Text({ bold: true, color: RED, children: [won(tripUsd())] }),
          Text({ dimColor: true, children: [`API 정가 $${tripUsd().toFixed(2)} · 환율 ${comma(rate)}원`] }),
        ),
        row('표시등', plain(`장거리 ${longHaulCount}회 · 5시간 최고 ${peakFiveHour}%`)),
        row('누적', plain(`오늘 ${won(recentUsd(now, 1))} · ${monthDay(ledger.since)}부터 ${won(ledger.totalUsd)}`)),
        rule,
        Text({ children: ['이용해 주셔서 감사합니다'] }),
      ],
    })
  })
}
