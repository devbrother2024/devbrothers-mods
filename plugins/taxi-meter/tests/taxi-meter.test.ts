import { expect, mock, test, type TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Limit = { kind: 'five_hour' | 'seven_day' | 'spend_limit'; percentUsed: number; resetsAt?: string }

const START = new Date(2026, 9, 4, 14, 0).getTime()
const RESET = new Date(2026, 9, 4, 19, 0).toISOString()
const COMPACT = { options: { krw_per_usd: 1400, style: 'compact', sound: true, tick_won: 1000 } }
const LED = { options: { ...COMPACT.options, style: 'led' } }

const band = (surface: 'terminal' | 'desktop' = 'terminal', isWorking = false) => ({
  plugin: 'taxi-meter',
  surface,
  component: 'AbovePrompt' as const,
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isWorking, maxRows: 20, bodyColumns: 150, scroll: { offset: 0, bodyRows: 20 }, view: {} },
})

const receiptPane = {
  plugin: 'taxi-meter',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'taxi-receipt',
  viewport: { columns: 100, rows: 40 },
  props: { title: '영수증', isFocused: true, bodyColumns: 60, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const ride = async ($: Engine, on: On, { cost = 0, limits = [] as Limit[], ledger = undefined as unknown } = {}) => {
  const commands: string[] = []
  const sounds: string[] = []
  let usd = cost
  const saved = new Map<string, unknown>(ledger ? [['ledger', ledger]] : [])
  const clock = mock.clock(on, { now: START })
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: START, context: { tokens: 1000, window: 200_000, percent: 0.5 }, rateLimits: limits, cost: { usd } },
  }))
  on('audio.play', ($, e) => {
    sounds.push(e.clip.asset ?? '')
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model },
    }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const measure = (usd: number, next: Limit[] = limits, percent = 0.5) =>
    $.session.measure({ context: { tokens: 1000, window: 200_000, percent }, rateLimits: next, cost: { usd }, changed: ['cost', 'rateLimits'] })

  const step = async (model: string) => {
    const stream = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1 })
    let piece = await stream.next()
    while (piece.done !== true) piece = await stream.next()
  }

  const prompt = (text: string) => $.turn.start({ text, turnId: `t-${text}` })

  const spend = (value: number) => {
    usd = value
  }

  return { commands, sounds, saved, clock, measure, step, prompt, spend }
}

test('session.start에서 /meter와 /receipt를 등록한다', COMPACT, async ($, on) => {
  const { commands } = await ride($, on)
  expect(commands).toEqual(['meter', 'receipt'])
})

test('빈차일 때는 0원과 한도 안내를 그리고 아래 그림을 지우지 않는다', COMPACT, async ($, on) => {
  await ride($, on)
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[빈차]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '한도는 첫 응답 뒤에 표시돼요' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

test('세션 시작 이후 늘어난 비용만 원화로 환산하고 딸깍 소리를 낸다', COMPACT, async ($, on) => {
  const { measure, sounds } = await ride($, on, { cost: 2 })
  await measure(7, [{ kind: 'five_hour', percentUsed: 42, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 31 }])
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩7,000' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[대기]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5시간 ████░░░░░░ 42% · 19:00 리셋 │ 주간 31%' })).toBeDefined()
  expect(sounds).toEqual(['sounds/tick.wav'])
})

test('5시간 한도 90%와 100%에서 문구를 바꾸고 알림음을 한 번씩 낸다', COMPACT, async ($, on) => {
  const { measure, sounds } = await ride($, on)
  await measure(0.1, [{ kind: 'five_hour', percentUsed: 91.5, resetsAt: RESET }])
  await measure(0.1, [{ kind: 'five_hour', percentUsed: 95, resetsAt: RESET }])
  let ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '곧 목적지입니다 · 5시간 █████████░ 91.5% · 19:00 리셋' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '곧 목적지입니다 · 5시간 █████████░ 95% · 19:00 리셋' })).toBeDefined()
  await ui.unmount()

  await measure(0.2, [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }])
  ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '하차하셔야 합니다 · 19:00 재승차' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[하차]' })).toBeDefined()
  expect(sounds.filter((s) => s === 'sounds/chime.wav').length).toBe(2)
})

test('모델에 따라 차종 표시등을 바꾸고 컨텍스트 50% 이상이면 장거리를 켠다', COMPACT, async ($, on) => {
  const { measure, step } = await ride($, on)
  await step('claude-opus-5-5')
  await measure(0.5, [], 62)
  const ui = await $.ui.mount(band('terminal', true))
  expect(await ui.find({ type: 'Text', text: '[모범]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[장거리]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[주행]' })).toBeDefined()
})

test('LED 방식은 터미널에서 미터기 패널로, 데스크톱이나 좁은 창에서는 한 줄로 그린다', LED, async ($, on) => {
  const { measure, step } = await ride($, on)
  await step('claude-opus-5-5')
  await measure(5, [], 62)
  const terminal = await $.ui.mount(band('terminal'))
  expect(await terminal.find({ type: 'Raster', key: 'fare' })).toBeDefined()
  expect(await terminal.find({ type: 'Raster', key: 'horse' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: '원' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: 'API 정가 환산' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: ' 대기 ' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: '62%' })).toBeDefined()
  for (const key of ['할증', '복합', '지불']) {
    expect((await terminal.find({ type: 'Text', text: `  ${key}  ` }))?.props.bold).toBe(true)
  }
  for (const key of ['빈차', '주행']) {
    expect((await terminal.find({ type: 'Text', text: `  ${key}  ` }))?.props.bold).toBe(false)
  }
  await terminal.unmount()

  const narrow = await $.ui.mount({ ...band('terminal'), props: { ...band('terminal').props, bodyColumns: 60 } })
  expect(await narrow.find({ type: 'Raster', key: 'fare' })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: '₩7,000' })).toBeDefined()
  await narrow.unmount()

  const desktop = await $.ui.mount(band('desktop'))
  expect(await desktop.find({ type: 'Raster', key: 'fare' })).toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: '₩7,000' })).toBeDefined()
})

test('새 프롬프트마다 0원에서 새로 승차하고 세션 합계는 이어서 센다', COMPACT, async ($, on) => {
  const { measure, prompt } = await ride($, on)
  await prompt('첫 요청')
  await measure(2)
  await prompt('두 번째 요청')
  let ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩0' })).toBeDefined()
  await ui.unmount()

  await measure(3)
  ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩1,400' })).toBeDefined()
  const report = await $.command.run({ command: 'meter', args: '' })
  expect(report.text).toContain('이번 승차 ₩1,400')
  expect(report.text).toContain('이번 세션 ₩4,200')
})

test('턴이 끝나기 전에도 단계마다 요금을 올린다', COMPACT, async ($, on) => {
  const { step, prompt, spend, sounds } = await ride($, on, { cost: 1 })
  await prompt('긴 작업')
  spend(1.5)
  await step('claude-sonnet-5-5')
  let ui = await $.ui.mount(band('terminal', true))
  expect(await ui.find({ type: 'Text', text: '₩700' })).toBeDefined()
  await ui.unmount()

  spend(2)
  await step('claude-sonnet-5-5')
  ui = await $.ui.mount(band('terminal', true))
  expect(await ui.find({ type: 'Text', text: '₩1,400' })).toBeDefined()
  expect(sounds).toEqual(['sounds/tick.wav'])
})

test('/clear처럼 엔진 비용이 줄면 그 값을 새 기준으로 삼아 계속 센다', COMPACT, async ($, on) => {
  const { measure, prompt } = await ride($, on, { cost: 5 })
  await measure(6)
  await prompt('클리어 후 요청')
  await measure(0.5)
  await measure(1)
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩1,400' })).toBeDefined()
})

test('/meter reset은 화면 요금과 누적을 모두 0원으로 만든다', COMPACT, async ($, on) => {
  const { measure, saved } = await ride($, on)
  await measure(2)
  const reset = await $.command.run({ command: 'meter', args: 'reset' })
  expect(reset.text).toBe('미터기와 누적 요금을 0원으로 초기화했어요.')
  expect((saved.get('ledger') as { totalUsd: number }).totalUsd).toBe(0)
  let ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩0' })).toBeDefined()
  await ui.unmount()

  await measure(3)
  ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩1,400' })).toBeDefined()
})

test('/meter reset은 데모 주행 화면도 끝내고 실제 미터기로 돌아온다', COMPACT, async ($, on) => {
  const { clock } = await ride($, on)
  await $.command.run({ command: 'meter', args: 'demo' })
  await clock.advance(12_000)
  await $.command.run({ command: 'meter', args: 'reset' })
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '데모 주행' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '[빈차]' })).toBeDefined()
})

test('/meter는 이번 승차·세션·오늘·누적을 보고하고 /meter reset은 누적도 비운다', COMPACT, async ($, on) => {
  const since = new Date(2026, 8, 20).toISOString()
  const today = '2026-10-04'
  const { measure, saved } = await ride($, on, {
    ledger: { since, totalUsd: 10, days: { '2026-10-01': 3, [today]: 1 } },
  })
  await measure(2, [{ kind: 'five_hour', percentUsed: 30, resetsAt: RESET }])

  const report = await $.command.run({ command: 'meter', args: '' })
  expect(report.text).toContain('이번 승차 ₩2,800 (API 정가 환산 $2.00 · 환율 1,400원)')
  expect(report.text).toContain('오늘 ₩4,200 · 최근 7일 ₩8,400 · 9/20부터 ₩16,800')
  expect(report.text).toContain('5시간 ███░░░░░░░ 30% · 19:00 리셋')

  expect(report.text).toContain('이번 세션 ₩2,800')
  const reset = await $.command.run({ command: 'meter', args: 'reset' })
  expect(reset.text).toBe('미터기와 누적 요금을 0원으로 초기화했어요.')
  expect((saved.get('ledger') as { totalUsd: number }).totalUsd).toBe(0)
})

test('/receipt는 영수증 창을 열고 승차 정보를 그린다', COMPACT, async ($, on) => {
  const { measure, step, clock } = await ride($, on)
  await step('claude-sonnet-5-5')
  await measure(1.5, [{ kind: 'five_hour', percentUsed: 12, resetsAt: RESET }])
  await clock.advance(25 * 60_000)

  expect(await $.command.run({ command: 'receipt', args: '' })).toEqual({})
  const pane = await $.ui.mount(receiptPane)
  expect(await pane.find({ type: 'Text', text: '영  수  증' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '14:00 → 14:25 (25분)' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '1,500 토큰 · 일반 100%' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '₩2,100' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'API 정가 $1.50 · 환율 1,400원' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '이용해 주셔서 감사합니다' })).toBeDefined()
})

test('/meter demo는 데모 주행으로 한도 소진까지 보여주고 다시 부르면 실제 미터기로 돌아온다', COMPACT, async ($, on) => {
  const { clock, sounds } = await ride($, on)
  expect(await $.command.run({ command: 'meter', args: 'demo' })).toEqual({})
  let ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '[빈차]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '데모 주행' })).toBeDefined()
  await ui.unmount()

  await clock.advance(3_000)
  ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '[주행]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[모범]' })).toBeDefined()
  await ui.unmount()

  await clock.advance(6_000)
  ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '[장거리]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '곧 목적지입니다 · 5시간 █████████░ 95% · 18:00 리셋 │ 주간 29%' })).toBeDefined()
  await ui.unmount()

  await clock.advance(3_000)
  ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩48,300' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[하차]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '하차하셔야 합니다 · 18:00 재승차' })).toBeDefined()
  expect(sounds.filter((s) => s === 'sounds/tick.wav').length).toBe(24)
  expect(sounds.filter((s) => s === 'sounds/chime.wav').length).toBe(2)
  await ui.unmount()

  const stop = await $.command.run({ command: 'meter', args: 'demo' })
  expect(stop.text).toBe('데모 주행을 끝내고 실제 미터기로 돌아왔어요.')
  ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: '₩0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '한도는 첫 응답 뒤에 표시돼요' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '데모 주행' })).toBeUndefined()
})
