import { expect, mock, test, type TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const ASK = { options: { mode: 'ask', sound: true, voice: true, voice_name: 'Yuna' } }
const BLOCK = { options: { mode: 'block', sound: false, voice: false, voice_name: 'Yuna' } }

const band = {
  plugin: 'taxi-speedcam',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 150, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}

const road = async ($: Engine, on: On, reply?: string) => {
  const asked: string[] = []
  const spoken: string[] = []
  const played: string[] = []
  const commands: string[] = []
  const clock = mock.clock(on, { now: new Date(2026, 9, 4, 15, 7).getTime() })
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: undefined }
  })
  on('audio.play', ($, e) => {
    played.push(e.clip.asset ?? '')
    return { value: undefined }
  })
  on('audio.speak', ($, e) => {
    spoken.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ran' }
    const question = e.questions[0].question
    asked.push(question)
    return reply === undefined ? { deny: 'dismissed' } : { result: { answers: { [question]: reply } } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command })
  return { asked, spoken, played, commands, clock, bash }
}

test('session.start에서 /speedcam을 등록한다', ASK, async ($, on) => {
  const { commands } = await road($, on, '가주세요')
  expect(commands).toEqual(['speedcam'])
})

test('안전한 명령은 묻지 않고 그대로 보낸다', ASK, async ($, on) => {
  const { bash, asked, played } = await road($, on, '가주세요')
  for (const command of [
    'git push origin main',
    'git push --follow-tags origin main',
    'git commit -m "fix: push -f 막기"',
    'rm -r build',
    'rm -f .DS_Store',
    'npm ci --production',
    'truncate -s 0 app.log',
    'psql -c "DELETE FROM users WHERE id = 1"',
    'git reset HEAD~1',
    'wrangler dev',
  ]) {
    expect(await bash(command)).toEqual({ result: 'ran' })
  }
  expect(asked).toEqual([])
  expect(played).toEqual([])
})

test('위험한 명령은 종류별 단속 카메라가 잡는다', BLOCK, async ($, on) => {
  const { bash } = await road($, on)
  const cases: [string, string][] = [
    ['git push --force origin main', '역주행 감지'],
    ['git push -f', '역주행 감지'],
    ['git push origin +main', '역주행 감지'],
    ['git -C repo push --force-with-lease', '역주행 감지'],
    ['cd app && git push -uf origin dev', '역주행 감지'],
    ['rm -rf node_modules', '낭떠러지 주의'],
    ['sudo rm -r -f /tmp/cache', '낭떠러지 주의'],
    ['rm --recursive --force dist', '낭떠러지 주의'],
    ['psql -c "DROP TABLE users"', '어린이 보호구역'],
    ['npx prisma migrate reset', '어린이 보호구역'],
    ['psql -c "DELETE FROM users"', '어린이 보호구역'],
    ['git reset --hard HEAD~1', '후진 주의'],
    ['git clean -fd', '후진 주의'],
    ['git checkout -- .', '후진 주의'],
    ['vercel --prod', '고속도로 진입'],
    ['npx wrangler deploy', '고속도로 진입'],
    ['terraform apply -auto-approve', '고속도로 진입'],
    ['npm publish', '고속도로 진입'],
  ]
  for (const [command, label] of cases) {
    const out = await bash(command)
    expect(out.deny ?? `통과: ${command}`).toContain(`[${label}]`)
  }
})

test('가주세요를 고르면 찰칵 소리와 음성 뒤에 명령을 보내고, 띠는 5초 뒤 사라진다', ASK, async ($, on) => {
  const { bash, asked, played, spoken, clock } = await road($, on, '가주세요')
  expect(await bash('git push --force origin main')).toEqual({ result: 'ran' })
  expect(asked).toEqual(['📸 찰칵! [역주행 감지] 원격 브랜치 히스토리를 덮어씁니다. 그대로 갈까요?\n$ git push --force origin main'])
  expect(played).toEqual(['sounds/shutter.wav'])

  await clock.advance(300)
  expect(spoken).toEqual(['역주행 차량이 감지되었습니다.'])

  let ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: ' 📸 역주행 감지 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 통과했어요 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '원격 브랜치 히스토리를 덮어씁니다' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'camera' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'stripe-top' })).toBeDefined()
  await ui.unmount()

  ui = await $.ui.mount({ ...band, props: { ...band.props, bodyColumns: 60 } })
  expect(await ui.find({ type: 'Text', text: '📸 [역주행 감지]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '통과했어요' })).toBeDefined()
  await ui.unmount()

  await clock.advance(5_000)
  ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: ' 📸 역주행 감지 ' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

test('세워주세요를 고르면 명령을 막고 Claude에게 이유를 알려준다', ASK, async ($, on) => {
  const { bash } = await road($, on, '세워주세요')
  const out = await bash('rm -rf ~/project')
  expect(out.deny).toContain('[낭떠러지 주의] 파일을 휴지통 없이 통째로 지웁니다')
  expect(out.deny).toContain('같은 명령을 다시 시도하지 말고')
})

test('질문을 닫거나 claude -p처럼 물어볼 사람이 없으면 세운다', ASK, async ($, on) => {
  const { bash } = await road($, on)
  const out = await bash('git reset --hard')
  expect(out.deny).toContain('[후진 주의]')
})

test('/speedcam은 이번 세션 단속 기록을 보여준다', ASK, async ($, on) => {
  const { bash } = await road($, on, '가주세요')
  expect((await $.command.run({ command: 'speedcam', args: '' })).text).toBe('📸 이번 세션 단속 기록이 없어요. 안전 운전 중이에요.')
  await bash('vercel --prod')
  await bash('git push -f')
  expect((await $.command.run({ command: 'speedcam', args: '' })).text).toBe(
    '📸 단속 2회 · 통과 2 · 정차 0\n15:07 [고속도로 진입] 통과 · vercel --prod\n15:07 [역주행 감지] 통과 · git push -f',
  )
})
