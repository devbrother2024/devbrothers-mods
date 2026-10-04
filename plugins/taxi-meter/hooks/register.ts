import type { Register } from 'claude-code'

type Tier = '일반' | '모범' | '블랙'
type Limit = { kind: string; percentUsed: number; resetsAt?: string }
type Ledger = { since: string; totalUsd: number; days: Record<string, number> }
type Line = { text: string; color?: string; bold?: boolean; dim?: boolean }
type View = { usd: number; limits: Limit[]; model?: string; longHaul: boolean; isWorking: boolean; isDemo: boolean }
type Demo = { elapsed: number; resetsAt: string; ticks: number; warned: number }

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
const BAR = 10

const DEMO_STEP_MS = 100
const DEMO_BOARD_MS = 600
const DEMO_OPUS_MS = 1_500
const DEMO_LONG_HAUL_MS = 5_000
const DEMO_NEAR_MS = 7_000
const DEMO_ARRIVE_MS = 10_500
const DEMO_USD = 34.5
const DEMO_TICK_WON = 2_000
const DEMO_FIVE_HOUR_FROM = 41
const DEMO_WEEK_FROM = 23
const DEMO_WEEK_TO = 31

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

const bar = (percent: number) => {
  const filled = Math.min(BAR, Math.max(0, Math.floor((percent / 100) * BAR)))
  return '█'.repeat(filled) + '░'.repeat(BAR - filled)
}

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
  let demo: Demo | undefined
  let demoTimer: { cancel: () => void } | undefined

  const tripUsd = () => Math.max(0, costUsd - seededUsd)
  const fare = (usd: number) => Math.round((usd * rate) / 10) * 10
  const won = (usd: number) => `₩${comma(fare(usd))}`
  const limitOf = (kind: string) => limits.find((limit) => limit.kind === kind)

  const recentUsd = (now: number, days: number) => {
    let sum = 0
    for (let i = 0; i < days; i++) sum += ledger.days[dayKey(now - i * DAY_MS)] ?? 0
    return sum
  }

  const realView = (isWorking: boolean): View => ({ usd: tripUsd(), limits, model, longHaul, isWorking, isDemo: false })

  const demoView = (ride: Demo): View => {
    const between = (from: number, to: number) => Math.min(1, Math.max(0, (ride.elapsed - from) / (to - from)))
    const progress = between(DEMO_BOARD_MS, DEMO_ARRIVE_MS)
    const isArrived = ride.elapsed >= DEMO_ARRIVE_MS
    const fiveHour = isArrived
      ? 100
      : ride.elapsed <= DEMO_NEAR_MS
        ? DEMO_FIVE_HOUR_FROM + (90 - DEMO_FIVE_HOUR_FROM) * between(DEMO_BOARD_MS, DEMO_NEAR_MS)
        : 90 + 9 * between(DEMO_NEAR_MS, DEMO_ARRIVE_MS)
    return {
      usd: DEMO_USD * progress,
      limits: [
        { kind: 'five_hour', percentUsed: Math.floor(fiveHour), resetsAt: ride.resetsAt },
        { kind: 'seven_day', percentUsed: Math.floor(DEMO_WEEK_FROM + (DEMO_WEEK_TO - DEMO_WEEK_FROM) * progress) },
      ],
      model: ride.elapsed >= DEMO_OPUS_MS ? 'claude-opus-5-5' : undefined,
      longHaul: ride.elapsed >= DEMO_LONG_HAUL_MS,
      isWorking: ride.elapsed >= DEMO_BOARD_MS && !isArrived,
      isDemo: true,
    }
  }

  const endDemo = () => {
    demoTimer?.cancel()
    demoTimer = undefined
    demo = undefined
  }

  const status = (view: View): Line => {
    const five = view.limits.find((limit) => limit.kind === 'five_hour')
    if (five && five.percentUsed >= 100) return { text: '[하차]', color: RED, bold: true }
    if (view.isWorking) return { text: '[주행]', color: GREEN, bold: true }
    if (view.usd === 0) return { text: '[빈차]', color: RED, bold: true }
    return { text: '[대기]', color: YELLOW }
  }

  const lamps = (view: View): Line[] => {
    const tier = tierOf(view.model)
    return [
      status(view),
      ...(tier ? [{ text: `[${tier}]`, color: TIER_COLOR[tier], bold: tier !== '일반' }] : []),
      ...(view.longHaul ? [{ text: '[장거리]', color: 'cyan' }] : []),
    ]
  }

  const limitLine = (view: View): Line => {
    const find = (kind: string) => view.limits.find((limit) => limit.kind === kind)
    const five = find('five_hour')
    const week = find('seven_day')
    const credit = find('spend_limit')
    if (!five && !week && !credit) return { text: '한도는 첫 응답 뒤에 표시돼요', dim: true }
    const reset = clockOf(five?.resetsAt)
    if (five && five.percentUsed >= 100) {
      return { text: `하차하셔야 합니다${reset ? ` · ${reset} 재승차` : ''}`, color: RED, bold: true }
    }
    const text = [
      five ? `5시간 ${bar(five.percentUsed)} ${five.percentUsed}%${reset ? ` · ${reset} 리셋` : ''}` : undefined,
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
      five || week ? limitLine(realView(false)).text : '한도: 아직 응답이 없어요',
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
      description: '택시 미터기: 이번 승차·오늘·누적 요금과 한도 (reset은 누적 초기화, demo는 촬영용 데모 주행)',
      argumentHint: '[reset|demo]',
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
    endDemo()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    endDemo()
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
    const arg = e.args.trim()
    if (arg === 'reset') {
      ledger = { since: new Date(now).toISOString(), totalUsd: 0, days: {} }
      await $.store.set(LEDGER, ledger)
      return { text: '누적 요금을 0원으로 초기화했어요.' }
    }
    if (arg === 'demo') {
      if (demo) {
        endDemo()
        $.ui.invalidate('ui.render')
        return { text: '데모 주행을 끝내고 실제 미터기로 돌아왔어요.' }
      }
      const reset = new Date(now)
      reset.setHours(reset.getHours() + 4, 0, 0, 0)
      demo = { elapsed: 0, resetsAt: reset.toISOString(), ticks: 0, warned: 0 }
      frame = 0
      demoTimer = $.clock.every(DEMO_STEP_MS, () => {
        if (!demo) return
        demo.elapsed += DEMO_STEP_MS
        const view = demoView(demo)
        if (view.isWorking) frame += 1
        const step = Math.floor(fare(view.usd) / DEMO_TICK_WON)
        if (step > demo.ticks) {
          demo.ticks = step
          if (sound) $.audio.play({ asset: TICK }).catch(() => {})
        }
        const five = view.limits[0].percentUsed
        const level = five >= 100 ? 100 : five >= 90 ? 90 : 0
        if (level > demo.warned) {
          demo.warned = level
          if (sound) $.audio.play({ asset: CHIME }).catch(() => {})
        }
        if (demo.elapsed >= DEMO_ARRIVE_MS) {
          demoTimer?.cancel()
          demoTimer = undefined
        }
        $.ui.invalidate('ui.render')
      })
      $.ui.invalidate('ui.render')
      return {}
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
    const view = demo ? demoView(demo) : realView(e.props.isWorking)
    const lampRow = lamps(view).map(text)
    const limit = text(limitLine(view))
    const horse = Text({ children: [track()] })
    const label = view.isDemo ? '원 · 데모 주행' : '원 · API 정가 환산'

    const meter =
      style === 'led' && e.surface === 'terminal' && 'Raster' in elements
        ? Box({
            flexDirection: 'row',
            columnGap: 2,
            children: [
              elements.Raster({ key: 'fare', ...ledDigits(comma(fare(view.usd))) }),
              Box({
                flexDirection: 'column',
                children: [
                  Box({ flexDirection: 'row', columnGap: 1, children: [Text({ dimColor: true, children: [label] }), ...lampRow] }),
                  horse,
                  limit,
                ],
              }),
            ],
          })
        : Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Text({ color: RED, bold: true, children: [won(view.usd)] }),
              ...lampRow,
              horse,
              limit,
              ...(view.isDemo ? [Text({ dimColor: true, children: ['데모 주행'] })] : []),
            ],
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
