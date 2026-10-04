import { expect, mock, test, type TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const VOICE = { options: { voice: true, voice_name: 'Yuna', sound: true } }
const QUIET = { options: { voice: false, voice_name: 'Yuna', sound: false } }

const band = {
  plugin: 'taxi-navi',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 150, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}

const drive = async ($: Engine, on: On, env: Record<string, string> = { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' }) => {
  const spoken: { text: string; voice?: string }[] = []
  const played: string[] = []
  const commands: string[] = []
  let nextId = 0
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, env)
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: undefined }
  })
  on('audio.speak', ($, e) => {
    spoken.push({ text: e.text, voice: e.voice })
    return { value: undefined }
  })
  on('audio.play', ($, e) => {
    played.push(e.clip.asset ?? '')
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++nextId), subject: e.subject } } }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    return { result: 'ok' }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const create = (subject: string, agentId?: string) =>
    $.tool.call({ tool: 'TaskCreate', subject, description: subject, activeForm: `${subject} 중`, ...(agentId ? { agentId } : {}) })
  const update = (taskId: string, status: 'pending' | 'in_progress' | 'completed' | 'deleted') =>
    $.tool.call({ tool: 'TaskUpdate', taskId, status })

  return { spoken, played, commands, clock, create, update }
}

test('session.start에서 /navi를 등록한다', VOICE, async ($, on) => {
  const { commands } = await drive($, on)
  expect(commands).toEqual(['navi'])
})

test('할 일을 만드는 동안은 조용히 경로만 그리고, 첫 작업이 시작되면 안내를 시작한다', VOICE, async ($, on) => {
  const { create, update, spoken } = await drive($, on)
  await create('로그인 API')
  await create('테스트 작성')
  await create('문서 정리')
  expect(spoken).toEqual([])

  await update('1', 'in_progress')
  expect(spoken).toEqual([{ text: '경로 안내를 시작합니다. 경유지 3곳입니다.', voice: 'Yuna' }])

  let ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Raster', key: 'sign' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '다음 안내' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '테스트 작성' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '경유지 0/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '🚕' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '지금 로그인 API 중' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  await ui.unmount()

  ui = await $.ui.mount({ ...band, props: { ...band.props, bodyColumns: 60 } })
  expect(await ui.find({ type: 'Text', text: '◉' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  0/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '지금 로그인 API 중 · 다음 안내 테스트 작성' })).toBeDefined()
})

test('주행 중 할 일이 늘면 경로를 재탐색하고, 하나 끝낼 때마다 딩 소리를 낸다', VOICE, async ($, on) => {
  const { create, update, spoken, played } = await drive($, on)
  await create('A')
  await create('B')
  await update('1', 'in_progress')
  await update('1', 'completed')
  expect(played).toEqual(['sounds/ding.wav'])

  await create('C')
  expect(spoken.at(-1)?.text).toBe('경로를 재탐색합니다. 경유지 3곳입니다.')
  const ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: '경로 재탐색' })).toBeDefined()
  await ui.unmount()

  await create('D')
  expect(spoken.filter((s) => s.text.startsWith('경로를 재탐색')).length).toBe(1)
})

test('모두 끝나면 딩 다음에 도착 안내를 하고, 다음 프롬프트에서 배너를 지운다', VOICE, async ($, on) => {
  const { create, update, spoken, played, clock } = await drive($, on)
  await create('A')
  await update('1', 'in_progress')
  await clock.advance(3 * 60_000)
  await update('1', 'completed')
  expect(played).toEqual(['sounds/ding.wav'])
  expect(spoken.at(-1)?.text).toBe('경로 안내를 시작합니다. 경유지 1곳입니다.')
  await clock.advance(400)
  expect(spoken.at(-1)?.text).toBe('목적지에 도착했습니다. 안내를 종료합니다.')

  let ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: '목적지에 도착했습니다' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '경유지 1곳 · 소요 3분' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '🏁' })).toBeDefined()
  await ui.unmount()

  await $.turn.start({ text: '다음 작업', turnId: 't2' })
  ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: /목적지/ })).toBeUndefined()
})

test('TodoWrite 목록도 같은 경로로 안내한다', VOICE, async ($, on) => {
  const { spoken } = await drive($, on)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: '스키마 설계', status: 'in_progress', activeForm: '스키마 설계 중' },
      { content: '마이그레이션', status: 'pending', activeForm: '마이그레이션 중' },
    ],
  })
  expect(spoken).toEqual([{ text: '경로 안내를 시작합니다. 경유지 2곳입니다.', voice: 'Yuna' }])
  const answer = await $.command.run({ command: 'navi', args: '' })
  expect(answer.text).toBe('🧭 경로 안내 0/2\n▶ 스키마 설계\n· 마이그레이션')
})

test('할 일 도구가 꺼진 환경이면 /navi가 켜는 방법을 알려준다', VOICE, async ($, on) => {
  await drive($, on, {})
  expect((await $.command.run({ command: 'navi', args: '' })).text).toBe(
    '안내 중인 경로가 없어요. Claude가 할 일 목록을 만들면 여기에 나타나요.\n' +
      'Opus 4.8·Sonnet 5·Fable 5 이후 모델은 할 일 도구가 기본으로 꺼져 있어요. CLAUDE_CODE_ENABLE_TODO_TOOLS=1 claude 로 시작하면 내비가 경로를 그립니다.',
  )
})

test('서브에이전트의 할 일은 무시하고, 음성·효과음을 끄면 조용히 그리기만 한다', QUIET, async ($, on) => {
  const { create, update, spoken, played } = await drive($, on)
  await create('서브에이전트 할 일', 'agent-1')
  expect((await $.command.run({ command: 'navi', args: '' })).text).toBe(
    '안내 중인 경로가 없어요. Claude가 할 일 목록을 만들면 여기에 나타나요.',
  )

  await create('A')
  await update('2', 'in_progress')
  await update('2', 'completed')
  expect(spoken).toEqual([])
  expect(played).toEqual([])
})
