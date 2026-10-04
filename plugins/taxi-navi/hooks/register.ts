import type { Register } from 'claude-code'

type Status = 'pending' | 'in_progress' | 'completed'
type Stop = { id: string; subject: string; status: Status; activeForm?: string }
type Cue = { say?: string; ding?: boolean }
type Line = { text: string; color?: string; bold?: boolean; dim?: boolean }

const DING = 'sounds/ding.wav'
const TODO_TOOLS_HINT =
  'Opus 4.8·Sonnet 5·Fable 5 이후 모델은 할 일 도구가 기본으로 꺼져 있어요. CLAUDE_CODE_ENABLE_TODO_TOOLS=1 claude 로 시작하면 내비가 경로를 그립니다.'
const REROUTE_QUIET_MS = 5_000
const SPEAK_AFTER_DING_MS = 400
const MAX_NODES = 12
const GREEN = '#34c759'
const YELLOW = '#ffcc00'

const isStatus = (value: unknown): value is Status =>
  value === 'pending' || value === 'in_progress' || value === 'completed'

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))}분`

const road = (stops: Stop[]): Line[] => {
  const focus = Math.max(0, stops.findIndex((stop) => stop.status !== 'completed'))
  const start = Math.min(Math.max(0, focus - 4), Math.max(0, stops.length - MAX_NODES))
  const shown = stops.slice(start, start + MAX_NODES)
  const parts: Line[] = start > 0 ? [{ text: '…━━', color: GREEN }] : []
  shown.forEach((stop, i) => {
    if (i > 0) parts.push(stop.status === 'pending' ? { text: '──', dim: true } : { text: '━━', color: GREEN })
    parts.push(
      stop.status === 'completed'
        ? { text: '●', color: GREEN }
        : stop.status === 'in_progress'
          ? { text: '◉', color: YELLOW, bold: true }
          : { text: '○', dim: true },
    )
  })
  if (start + MAX_NODES < stops.length) parts.push({ text: '──…', dim: true })
  return parts
}

export const register: Register = (on, options) => {
  const voice = options.voice !== false
  const voiceName =
    typeof options.voice_name === 'string' && options.voice_name.trim() ? options.voice_name.trim() : 'Yuna'
  const sound = options.sound !== false

  let stops: Stop[] = []
  let started = false
  let startedAt = 0
  let lastReroute = Number.NEGATIVE_INFINITY
  let arrived: { count: number; ms: number } | undefined
  const retired = new Set<string>()

  const finished = (list: Stop[]) => list.filter((stop) => stop.status === 'completed').length

  const arrive = (now: number): Cue => {
    arrived = { count: stops.length, ms: now - startedAt }
    for (const stop of stops) retired.add(stop.id)
    stops = []
    started = false
    return { say: '목적지에 도착했습니다. 안내를 종료합니다.', ding: true }
  }

  const apply = (next: Stop[], now: number): Cue => {
    const before = stops
    stops = next
    if (stops.length === 0) {
      started = false
      return {}
    }
    const isAllDone = finished(stops) === stops.length
    if (!started) {
      if (stops.every((stop) => stop.status === 'pending')) return {}
      started = true
      startedAt = now
      arrived = undefined
      return isAllDone ? arrive(now) : { say: `경로 안내를 시작합니다. 경유지 ${stops.length}곳입니다.` }
    }
    if (isAllDone) return arrive(now)
    const ids = new Set(before.map((stop) => stop.id))
    const isChanged = stops.length !== before.length || stops.some((stop) => !ids.has(stop.id))
    if (isChanged && now - lastReroute >= REROUTE_QUIET_MS) {
      lastReroute = now
      return { say: `경로를 재탐색합니다. 경유지 ${stops.length}곳입니다.` }
    }
    return finished(stops) > finished(before) ? { ding: true } : {}
  }

  const report = (hasTodoTools: boolean) => {
    if (stops.length === 0) {
      if (arrived) return `🏁 목적지 도착 · 경유지 ${arrived.count}곳 · 소요 ${minutes(arrived.ms)}`
      const empty = '안내 중인 경로가 없어요. Claude가 할 일 목록을 만들면 여기에 나타나요.'
      return hasTodoTools ? empty : `${empty}\n${TODO_TOOLS_HINT}`
    }
    const mark = { completed: '✓', in_progress: '▶', pending: '·' } as const
    return [`🧭 경로 안내 ${finished(stops)}/${stops.length}`, ...stops.map((stop) => `${mark[stop.status]} ${stop.subject}`)].join('\n')
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'navi', description: '택시 내비: 지금 경로(할 일 목록)와 진행 상황', immediate: true })
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (arrived) {
      arrived = undefined
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('tool.call', { tool: ['TaskCreate', 'TaskUpdate', 'TaskList', 'TodoWrite'] }, async ($, e, next) => {
    const out = await next(e)
    if (e.agentId || out.deny || out.isError) return out

    let updated: Stop[] | undefined
    switch (e.tool) {
      case 'TaskCreate': {
        const id = (out.result as { task?: { id?: string } } | undefined)?.task?.id
        if (id) updated = [...stops, { id, subject: e.subject, status: 'pending', activeForm: e.activeForm }]
        break
      }
      case 'TaskUpdate': {
        if (e.status === 'deleted') {
          updated = stops.filter((stop) => stop.id !== e.taskId)
          break
        }
        const status = e.status
        updated = stops.map((stop) =>
          stop.id === e.taskId
            ? {
                ...stop,
                ...(isStatus(status) ? { status } : {}),
                ...(e.subject ? { subject: e.subject } : {}),
                ...(e.activeForm ? { activeForm: e.activeForm } : {}),
              }
            : stop,
        )
        break
      }
      case 'TaskList': {
        const tasks = (out.result as { tasks?: { id: string; subject: string; status: string }[] } | undefined)?.tasks
        if (Array.isArray(tasks)) {
          updated = tasks
            .filter((task) => !retired.has(task.id) && isStatus(task.status))
            .map((task) => ({
              id: task.id,
              subject: task.subject,
              status: task.status as Status,
              activeForm: stops.find((stop) => stop.id === task.id)?.activeForm,
            }))
        }
        break
      }
      case 'TodoWrite': {
        updated = e.todos
          .map((todo) => ({ id: `todo:${todo.content}`, subject: todo.content, status: todo.status, activeForm: todo.activeForm }))
          .filter((stop) => !retired.has(stop.id))
        break
      }
    }
    if (!updated) return out

    const cue = apply(updated, await $.clock.now())
    if (cue.ding && sound) $.audio.play({ asset: DING }).catch(() => {})
    if (cue.say && voice) {
      const text = cue.say
      if (cue.ding && sound) $.clock.after(SPEAK_AFTER_DING_MS, () => $.audio.speak(text, { voice: voiceName }).catch(() => {}))
      else $.audio.speak(text, { voice: voiceName }).catch(() => {})
    }
    $.ui.invalidate('ui.render')
    return out
  })

  on('command.run', { command: 'navi' }, async ($) => {
    const flag = await $.env.get('CLAUDE_CODE_ENABLE_TODO_TOOLS')
    return { text: report(/^(1|true)$/i.test(flag ?? '')) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (stops.length === 0 && !arrived)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const text = (line: Line) =>
      Text({
        ...(line.color ? { color: line.color } : {}),
        ...(line.bold ? { bold: true } : {}),
        ...(line.dim ? { dimColor: true } : {}),
        children: [line.text],
      })

    const current = stops.find((stop) => stop.status === 'in_progress')
    const upcoming = stops.find((stop) => stop.status === 'pending')
    const guide = [
      current ? `지금 ${current.activeForm || current.subject}` : undefined,
      upcoming ? `다음 안내 ${upcoming.subject}` : undefined,
    ]
      .filter((part) => part !== undefined)
      .join(' · ')

    const navi =
      stops.length === 0 && arrived
        ? Text({ color: GREEN, bold: true, children: [`🏁 목적지에 도착했습니다 · 경유지 ${arrived.count}곳 · 소요 ${minutes(arrived.ms)}`] })
        : Box({
            flexDirection: 'column',
            children: [
              Box({
                flexDirection: 'row',
                children: [
                  Text({ children: ['🧭 '] }),
                  ...road(stops).map(text),
                  Text({ bold: true, children: [`  ${finished(stops)}/${stops.length}`] }),
                ],
              }),
              Text({ wrap: 'truncate-end', children: [guide || '경로를 계산하고 있어요'] }),
            ],
          })

    const below = await next(e)
    return below ? Box({ flexDirection: 'column', children: [navi, below] }) : navi
  })
}
