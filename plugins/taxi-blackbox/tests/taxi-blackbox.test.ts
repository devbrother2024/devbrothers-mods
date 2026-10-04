import { expect, mock, test, type TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const OPTIONS = { options: { before: 2 } }

const band = {
  plugin: 'taxi-blackbox',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 150, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}

const pane = {
  plugin: 'taxi-blackbox',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'taxi-blackbox',
  viewport: { columns: 140, rows: 40 },
  props: { title: '블랙박스', isFocused: true, bodyColumns: 120, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const record = async ($: Engine, on: On) => {
  const commands: string[] = []
  const clock = mock.clock(on, { now: new Date(2026, 9, 4, 15, 0, 0).getTime() })
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', ($, e) => {
    const command = e.tool === 'Bash' ? e.command : ''
    if (command.includes('fail')) return { result: 'exit 1: test failed', isError: true }
    if (command.includes('push -f')) return { deny: 'taxi-speedcam이 세웠어요: [역주행 감지]' }
    return { result: 'ok' }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const bash = async (command: string, agentId?: string) => {
    await clock.advance(1_000)
    return $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) })
  }
  return { commands, clock, bash }
}

test('session.start에서 /blackbox를 등록하고 REC 띠를 그린다', OPTIONS, async ($, on) => {
  const { commands, bash } = await record($, on)
  expect(commands).toEqual(['blackbox'])
  await bash('ls')
  await bash('npm test -- fail')
  const ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: '● REC' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '00:02 · 기록 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '사고 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

test('결과를 바꾸지 않고 그대로 돌려준다', OPTIONS, async ($, on) => {
  const { bash } = await record($, on)
  expect(await bash('ls')).toEqual({ result: 'ok' })
  expect(await bash('npm test -- fail')).toEqual({ result: 'exit 1: test failed', isError: true })
  expect(await bash('git push -f')).toEqual({ deny: 'taxi-speedcam이 세웠어요: [역주행 감지]' })
})

test('사고가 없으면 최근 동작을 보여준다', OPTIONS, async ($, on) => {
  const { bash } = await record($, on)
  await bash('ls')
  await bash('pwd')
  await bash('git status')
  await $.command.run({ command: 'blackbox', args: '' })
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: '블랙박스 · 기록 3 · 사고 없음' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'ls' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'git status' })).toBeDefined()
})

test('사고 창은 최신 사고부터 보여주고 이전 사고로 넘길 수 있다', OPTIONS, async ($, on) => {
  const { bash } = await record($, on)
  await bash('npm install')
  await bash('npm test -- fail')
  await bash('git add .', 'agent-7')
  await bash('git commit -m wip')
  await bash('git push -f origin main')

  await $.command.run({ command: 'blackbox', args: '' })
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: '사고 2/2 · Bash 거부' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↳ Bash' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'git commit -m wip' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '└ taxi-speedcam이 세웠어요: [역주행 감지]' })).toBeDefined()

  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: '사고 1/2 · Bash 오류' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '15:00:01' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '└ exit 1: test failed' })).toBeDefined()
})

test('토큰과 비밀번호는 가려서 기록한다', OPTIONS, async ($, on) => {
  const { bash } = await record($, on)
  await bash('curl -H "Authorization: Bearer abc.def-123" https://api.example.com')
  await bash('API_KEY=sk-ant-1234567890abcdef npm run deploy')
  await $.command.run({ command: 'blackbox', args: '' })
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: 'curl -H "Authorization: Bearer •••" https://api.example.com' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'API_KEY=••• npm run deploy' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sk-ant-1234/ })).toBeUndefined()
})
