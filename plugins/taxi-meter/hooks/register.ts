import type { Register } from 'claude-code'

type Tier = '일반' | '모범' | '블랙'
type Limit = { kind: string; percentUsed: number; resetsAt?: string }
type Ledger = { since: string; totalUsd: number; days: Record<string, number> }
type Line = { text: string; color?: string; bold?: boolean; dim?: boolean }
type State = '빈차' | '주행' | '대기' | '하차'
type View = { usd: number; limits: Limit[]; model?: string; longHaul: boolean; isWorking: boolean; isDemo: boolean; speed: number; context?: number }
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
const BAR = 10

const PANEL_WIDTH = 70
const PANEL_ROWS = 9
const SCREEN = '#121212'
const SCREEN_RGB = 0x121212
const BEZEL = '#5f656d'
const DIGIT_RGB = 0xf2f6ff
const STOP_RGB = 0xff3b30
const HORSE_RGB = 0x5ee35a
const HORSE_IDLE_RGB = 0x2f7a33
const BRAND = '#ffd60a'
const PURPLE = '#d07cff'
const BLUE = '#4d8dff'
const LCD_GREEN = '#b6f24a'
const LEGEND = '#9aa0a6'
const KEY_TEXT = '#111111'

const KEYS: readonly { label: string; on: string; off: string }[] = [
  { label: '빈차', on: '#f4f4f4', off: '#3b3d40' },
  { label: '주행', on: '#bdb8ff', off: '#2f2d4d' },
  { label: '할증', on: '#ff5c8a', off: '#4a1d2a' },
  { label: '복합', on: '#ffd60a', off: '#463b0a' },
  { label: '지불', on: '#8fe04c', off: '#24401a' },
]

const DEMO_STEP_MS = 100
const DEMO_BOARD_MS = 600
const DEMO_OPUS_MS = 1_500
const DEMO_NEAR_MS = 7_000
const DEMO_ARRIVE_MS = 10_500
const DEMO_USD = 34.5
const DEMO_TICK_WON = 2_000
const DEMO_FIVE_HOUR_FROM = 41
const DEMO_WEEK_FROM = 23
const DEMO_WEEK_TO = 31
const DEMO_CONTEXT_FROM = 20
const DEMO_CONTEXT_TO = 85

const FONT: Record<string, readonly string[]> = {
  '0': ['.#######.', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '.#######.'],
  '1': ['...###...', '.#####...', '....##...', '....##...', '....##...', '....##...', '....##...', '.#######.'],
  '2': ['.#######.', '##.....##', '.......##', '.....###.', '...###...', '.###.....', '##.......', '#########'],
  '3': ['.#######.', '##.....##', '.......##', '...#####.', '.......##', '.......##', '##.....##', '.#######.'],
  '4': ['.....###.', '....####.', '...##.##.', '..##..##.', '.##...##.', '#########', '......##.', '......##.'],
  '5': ['#########', '##.......', '##.......', '########.', '.......##', '.......##', '##.....##', '.#######.'],
  '6': ['..######.', '.##......', '##.......', '########.', '##.....##', '##.....##', '##.....##', '.#######.'],
  '7': ['#########', '.......##', '......##.', '.....##..', '....##...', '...##....', '...##....', '...##....'],
  '8': ['.#######.', '##.....##', '##.....##', '.#######.', '##.....##', '##.....##', '##.....##', '.#######.'],
  '9': ['.#######.', '##.....##', '##.....##', '##.....##', '.########', '.......##', '......##.', '.######..'],
  ',': ['...', '...', '...', '...', '...', '.##', '.##', '##.'],
}

const HORSE: readonly (readonly string[])[] = [
  [
    '..................##..',
    '................######',
    '...............####.##',
    '##............####....',
    '.###############......',
    '..#############.......',
    '..##.##.....##.##.....',
    '.##...##...##...##....',
  ],
  [
    '..................##..',
    '................######',
    '...............####.##',
    '.#............####....',
    '################......',
    '..#############.......',
    '...##.##...##.##......',
    '...##.##...##.##......',
  ],
].map((rows) => rows.map((row) => [...row].reverse().join('')))

const QUADRANT = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']

const TIER_COLOR: Record<Tier, string> = { 일반: 'gray', 모범: YELLOW, 블랙: 'white' }

const STATE_LAMP: Record<State, Line> = {
  하차: { text: '[하차]', color: RED, bold: true },
  주행: { text: '[주행]', color: GREEN, bold: true },
  빈차: { text: '[빈차]', color: RED, bold: true },
  대기: { text: '[대기]', color: YELLOW },
}

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

const quadrants = (bitmap: readonly string[], on: number, off: number) => {
  const width = Math.ceil(Math.max(...bitmap.map((row) => row.length)) / 2) * 2
  const height = Math.ceil(bitmap.length / 2) * 2
  const lit = (x: number, y: number) => bitmap[y]?.[x] === '#'
  const numbers: number[] = []
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const mask = (lit(x, y) ? 1 : 0) | (lit(x + 1, y) ? 2 : 0) | (lit(x, y + 1) ? 4 : 0) | (lit(x + 1, y + 1) ? 8 : 0)
      numbers.push(QUADRANT[mask].codePointAt(0) ?? 32, on, off)
    }
  }
  return { columns: width / 2, rows: height / 2, cells: base64(new Uint8Array(Uint32Array.from(numbers).buffer)) }
}

const fareBitmap = (text: string) => {
  const rows = Array.from({ length: 8 }, () => '')
  for (const char of text) {
    const glyph = FONT[char]
    if (!glyph) continue
    glyph.forEach((row, y) => (rows[y] += `${row}.`))
  }
  return rows
}

export const register: Register = (on, options) => {
  const rate = positive(options.krw_per_usd, 1400)
  const style = options.style === 'compact' ? 'compact' : 'led'
  const sound = options.sound !== false
  const tickWon = positive(options.tick_won, 1000)

  let startedAt = 0
  let lastCostUsd = 0
  let rideUsd = 0
  let sessionUsd = 0
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
  let speed = 0
  const tokensByTier: Record<Tier, number> = { 일반: 0, 모범: 0, 블랙: 0 }
  let ledger: Ledger = { since: '', totalUsd: 0, days: {} }
  let timer: { cancel: () => void } | undefined
  let demo: Demo | undefined
  let demoTimer: { cancel: () => void } | undefined

  const fare = (usd: number) => Math.round((usd * rate) / 10) * 10
  const won = (usd: number) => `₩${comma(fare(usd))}`
  const limitOf = (kind: string) => limits.find((limit) => limit.kind === kind)

  const recentUsd = (now: number, days: number) => {
    let sum = 0
    for (let i = 0; i < days; i++) sum += ledger.days[dayKey(now - i * DAY_MS)] ?? 0
    return sum
  }

  const realView = (isWorking: boolean): View => ({
    usd: rideUsd,
    limits,
    model,
    longHaul,
    isWorking,
    isDemo: false,
    speed: isWorking ? speed : 0,
    context: contextPercent,
  })

  const demoView = (ride: Demo): View => {
    const between = (from: number, to: number) => Math.min(1, Math.max(0, (ride.elapsed - from) / (to - from)))
    const progress = between(DEMO_BOARD_MS, DEMO_ARRIVE_MS)
    const isArrived = ride.elapsed >= DEMO_ARRIVE_MS
    const fiveHour = isArrived
      ? 100
      : ride.elapsed <= DEMO_NEAR_MS
        ? DEMO_FIVE_HOUR_FROM + (90 - DEMO_FIVE_HOUR_FROM) * between(DEMO_BOARD_MS, DEMO_NEAR_MS)
        : 90 + 9 * between(DEMO_NEAR_MS, DEMO_ARRIVE_MS)
    const isWorking = ride.elapsed >= DEMO_BOARD_MS && !isArrived
    const context = DEMO_CONTEXT_FROM + (DEMO_CONTEXT_TO - DEMO_CONTEXT_FROM) * progress
    return {
      usd: DEMO_USD * progress,
      limits: [
        { kind: 'five_hour', percentUsed: Math.floor(fiveHour), resetsAt: ride.resetsAt },
        { kind: 'seven_day', percentUsed: Math.floor(DEMO_WEEK_FROM + (DEMO_WEEK_TO - DEMO_WEEK_FROM) * progress) },
      ],
      model: ride.elapsed >= DEMO_OPUS_MS ? 'claude-opus-5-5' : undefined,
      longHaul: context >= LONG_HAUL_PERCENT,
      isWorking,
      isDemo: true,
      speed: isWorking ? 62 + 24 * Math.sin(ride.elapsed / 650) : 0,
      context,
    }
  }

  const endDemo = () => {
    demoTimer?.cancel()
    demoTimer = undefined
    demo = undefined
  }

  const stateOf = (view: View): State => {
    const five = view.limits.find((limit) => limit.kind === 'five_hour')
    if (five && five.percentUsed >= 100) return '하차'
    if (view.isWorking) return '주행'
    return view.usd === 0 ? '빈차' : '대기'
  }

  const status = (view: View): Line => STATE_LAMP[stateOf(view)]

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
      `이번 승차 ${won(rideUsd)} (API 정가 환산 $${rideUsd.toFixed(2)} · 환율 ${comma(rate)}원)`,
      `이번 세션 ${won(sessionUsd)} (API 정가 환산 $${sessionUsd.toFixed(2)})`,
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
      description: '택시 미터기: 이번 승차·세션·오늘·누적 요금과 한도 (reset은 미터기와 누적 초기화, demo는 촬영용 데모 주행)',
      argumentHint: '[reset|demo]',
      immediate: true,
    })
    await $.command.register({ name: 'receipt', description: '택시 영수증 열기', immediate: true })
    const now = await $.clock.now()
    const saved = await $.store.get(LEDGER)
    ledger = isLedger(saved) ? saved : { since: new Date(now).toISOString(), totalUsd: 0, days: {} }
    const usage = await $.session.usage()
    startedAt = usage.startedAt || now
    lastCostUsd = usage.cost?.usd ?? 0
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
    if (e.text) {
      rideUsd = 0
      ticks = 0
    }
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
    const stepStartedAt = await $.clock.now()
    const result = yield* next(e)
    const usage = result.usage
    const seconds = ((await $.clock.now()) - stepStartedAt) / 1000
    if (!e.agentId && usage?.output_tokens && seconds > 0) speed = usage.output_tokens / seconds
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

    const costUsd = e.cost?.usd
    const delta = costUsd === undefined ? 0 : costUsd >= lastCostUsd ? costUsd - lastCostUsd : costUsd
    if (costUsd !== undefined) lastCostUsd = costUsd
    if (delta > 0) {
      rideUsd += delta
      sessionUsd += delta
      const saved = await $.store.get(LEDGER)
      ledger = credit(isLedger(saved) ? saved : ledger, await $.clock.now(), delta)
      await $.store.set(LEDGER, ledger)
      const step = Math.floor(fare(rideUsd) / tickWon)
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
      rideUsd = 0
      sessionUsd = 0
      ticks = 0
      endDemo()
      $.ui.invalidate('ui.render')
      return { text: '미터기와 누적 요금을 0원으로 초기화했어요.' }
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

    const panel = () => {
      if (!('Raster' in elements)) return undefined
      const { Raster } = elements
      const state = stateOf(view)
      const tier = tierOf(view.model)
      const lit = [
        state === '빈차',
        state === '주행',
        tier === '모범' || tier === '블랙',
        view.longHaul,
        state === '대기' || state === '하차',
      ]
      const cell = (width: number, children: ReturnType<typeof Text>[]) =>
        Box({ width, flexDirection: 'column', children })
      const blank = Text({ children: [' '] })
      const legend = limitLine(view)

      return Box({
        width: PANEL_WIDTH,
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: BEZEL,
        backgroundColor: SCREEN,
        paddingX: 1,
        children: [
          Box({
            flexDirection: 'row',
            justifyContent: 'space-between',
            children: [
              Box({
                flexDirection: 'row',
                columnGap: 3,
                children: [
                  Text({ color: BRAND, bold: true, children: ['클로드·택시+'] }),
                  Text({ color: BLUE, bold: true, children: [tier ?? '--'] }),
                  Text({ color: LCD_GREEN, bold: true, children: [`${view.speed.toFixed(1)} tok/s`] }),
                ],
              }),
              Text({ color: LEGEND, children: ['ELECTRONIC TAXIMETER'] }),
            ],
          }),
          Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              cell(11, [
                Raster({
                  key: 'horse',
                  ...quadrants(HORSE[view.isWorking ? frame % HORSE.length : 0], view.isWorking ? HORSE_RGB : HORSE_IDLE_RGB, SCREEN_RGB),
                }),
              ]),
              Box({
                flexGrow: 1,
                flexDirection: 'row',
                justifyContent: 'flex-end',
                children: [
                  Raster({ key: 'fare', ...quadrants(fareBitmap(comma(fare(view.usd))), state === '하차' ? STOP_RGB : DIGIT_RGB, SCREEN_RGB) }),
                ],
              }),
              cell(5, [blank, Text({ color: '#ffffff', bold: true, children: ['원'] }), Text({ color: LEGEND, children: ['(WON)'] })]),
              cell(8, [
                blank,
                Text({ color: LCD_GREEN, bold: true, children: [view.context === undefined ? '--%' : `${Math.round(view.context)}%`] }),
                Text({ color: LEGEND, children: ['컨텍스트'] }),
              ]),
            ],
          }),
          Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Text({ color: '#ffffff', backgroundColor: BLUE, bold: true, children: [` ${state} `] }),
              Text({
                color: legend.color ?? PURPLE,
                ...(legend.bold ? { bold: true } : {}),
                wrap: 'truncate-end',
                children: [legend.text],
              }),
            ],
          }),
          Box({
            flexDirection: 'row',
            justifyContent: 'space-between',
            children: [
              Box({
                flexDirection: 'row',
                columnGap: 1,
                children: KEYS.map((key, i) =>
                  Text({
                    color: lit[i] ? KEY_TEXT : LEGEND,
                    backgroundColor: lit[i] ? key.on : key.off,
                    bold: lit[i],
                    children: [`  ${key.label}  `],
                  }),
                ),
              }),
              Text({ color: LEGEND, children: [view.isDemo ? '데모 주행' : 'API 정가 환산'] }),
            ],
          }),
        ],
      })
    }

    const fits = e.surface === 'terminal' && e.props.bodyColumns >= PANEL_WIDTH && e.props.maxRows >= PANEL_ROWS
    const meter =
      (style === 'led' && fits ? panel() : undefined) ??
      Box({
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
          Text({ bold: true, color: RED, children: [won(sessionUsd)] }),
          Text({ dimColor: true, children: [`API 정가 $${sessionUsd.toFixed(2)} · 환율 ${comma(rate)}원`] }),
        ),
        row('표시등', plain(`장거리 ${longHaulCount}회 · 5시간 최고 ${peakFiveHour}%`)),
        row('누적', plain(`오늘 ${won(recentUsd(now, 1))} · ${monthDay(ledger.since)}부터 ${won(ledger.totalUsd)}`)),
        rule,
        Text({ children: ['이용해 주셔서 감사합니다'] }),
      ],
    })
  })
}
