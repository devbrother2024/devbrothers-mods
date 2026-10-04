import type { Register } from 'claude-code'

type Status = 'pending' | 'in_progress' | 'completed'
type Stop = { id: string; subject: string; status: Status; activeForm?: string }
type Cue = { say?: string; ding?: boolean; reroute?: boolean }
type Line = { text: string; color?: string; bold?: boolean; dim?: boolean }

const DING = 'sounds/ding.wav'
const TODO_TOOLS_HINT =
  'Opus 4.8·Sonnet 5·Fable 5 이후 모델은 할 일 도구가 기본으로 꺼져 있어요. CLAUDE_CODE_ENABLE_TODO_TOOLS=1 claude 로 시작하면 내비가 경로를 그립니다.'
const REROUTE_QUIET_MS = 5_000
const SPEAK_AFTER_DING_MS = 400
const MAX_NODES = 12
const GREEN = '#34c759'
const YELLOW = '#ffcc00'

const PANEL_WIDTH = 70
const PANEL_ROWS = 3
const TILE_WIDTH = 8
const SCREEN = '#00005f'
const TILE = '#005fd7'
const TILE_RGB = 0x005fd7
const ARRIVE_TILE = '#2c2c2e'
const ARRIVE_TILE_RGB = 0x2c2c2e
const ROUTE_DONE = '#5fafff'
const ROUTE_LEFT = '#5f5f87'
const LABEL = '#87afff'
const WHITE = '#ffffff'

const ARROWS = {
  straight: ['.....##.....', '....####....', '...######...', '..########..', '....####....', '....####....'],
  reroute: ['...######...', '..##....##..', '..##....##..', '######..##..', '.####...##..', '..##....##..'],
} as const

const QUADRANT = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']

const base64 = (bytes: Uint8Array) => {
  const native = bytes as Uint8Array & { toBase64?: () => string }
  if (native.toBase64) return native.toBase64()
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const quadrants = (lit: (x: number, y: number) => boolean, columns: number, rows: number, on: number, off: number) => {
  const numbers: number[] = []
  for (let y = 0; y < rows * 2; y += 2) {
    for (let x = 0; x < columns * 2; x += 2) {
      const mask = (lit(x, y) ? 1 : 0) | (lit(x + 1, y) ? 2 : 0) | (lit(x, y + 1) ? 4 : 0) | (lit(x + 1, y + 1) ? 8 : 0)
      numbers.push(QUADRANT[mask].codePointAt(0) ?? 32, on, off)
    }
  }
  return { columns, rows, cells: base64(new Uint8Array(Uint32Array.from(numbers).buffer)) }
}

const arrow = (kind: keyof typeof ARROWS) => quadrants((x, y) => ARROWS[kind][y]?.[x] === '#', 6, 3, 0xffffff, TILE_RGB)
const flag = quadrants((x, y) => x === 0 || (x >= 2 && y < 4 && (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0), 6, 3, 0xffffff, ARRIVE_TILE_RGB)

const route = (stops: Stop[], width: number, isArrived: boolean): Line[] => {
  const focus = isArrived ? stops.length : Math.max(0, stops.findIndex((stop) => stop.status !== 'completed'))
  const start = Math.min(Math.max(0, focus - 4), Math.max(0, stops.length - MAX_NODES))
  const shown = stops.slice(start, start + MAX_NODES)
  const nodes = shown.map((stop, i) =>
    isArrived || stop.status === 'completed'
      ? { text: '●', color: GREEN, width: 1 }
      : start + i === focus
        ? { text: '🚕', width: 2 }
        : { text: '○', color: ROUTE_LEFT, width: 1 },
  )
  const finish = isArrived ? { text: '🏁', width: 2 } : { text: '◎', color: WHITE, width: 1 }
  const fixed = nodes.reduce((sum, node) => sum + node.width, 0) + finish.width
  const segment = Math.max(1, Math.min(16, Math.floor((width - fixed) / Math.max(1, shown.length))))
  const parts: Line[] = []
  nodes.forEach((node, i) => {
    const isDone = isArrived || start + i < focus
    parts.push(node, isDone ? { text: '━'.repeat(segment), color: ROUTE_DONE } : { text: '─'.repeat(segment), color: ROUTE_LEFT })
  })
  parts.push(finish)
  return parts
}

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
      return { say: `경로를 재탐색합니다. 경유지 ${stops.length}곳입니다.`, reroute: true }
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
    if (cue.reroute) $.clock.after(REROUTE_QUIET_MS, () => $.ui.invalidate('ui.render'))
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
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
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

    const now = await $.clock.now()
    const panel = () => {
      if (!('Raster' in elements) || e.props.bodyColumns < PANEL_WIDTH || e.props.maxRows < PANEL_ROWS) return undefined
      const { Raster } = elements
      const trip = stops.length === 0 ? arrived : undefined
      const isArrived = trip !== undefined
      const isRerouting = !isArrived && now - lastReroute < REROUTE_QUIET_MS
      const list = isArrived ? [] : stops
      const row = (left: ReturnType<typeof Text>[], right: ReturnType<typeof Text>) =>
        Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          children: [Box({ flexDirection: 'row', columnGap: 1, flexShrink: 1, children: left }), right],
        })
      const info = trip
        ? [
            row([Text({ bold: true, color: GREEN, children: ['목적지에 도착했습니다'] })], Text({ bold: true, color: WHITE, children: ['안내 종료'] })),
            Box({ flexDirection: 'row', children: route(Array.from({ length: trip.count }, (_, i) => ({ id: String(i), subject: '', status: 'completed' as const })), PANEL_WIDTH - TILE_WIDTH - 3, true).map(text) }),
            Text({ color: LABEL, children: [`경유지 ${trip.count}곳 · 소요 ${minutes(trip.ms)}`] }),
          ]
        : [
            row(
              [
                Text({ color: isRerouting ? YELLOW : LABEL, bold: isRerouting, children: [isRerouting ? '경로 재탐색' : '다음 안내'] }),
                Text({ bold: true, color: WHITE, wrap: 'truncate-end', children: [upcoming?.subject ?? '목적지'] }),
              ],
              Text({ bold: true, color: WHITE, children: [`경유지 ${finished(list)}/${list.length}`] }),
            ),
            Box({ flexDirection: 'row', children: route(list, PANEL_WIDTH - TILE_WIDTH - 3, false).map(text) }),
            row(
              [Text({ color: GREEN, wrap: 'truncate-end', children: [current ? `지금 ${current.activeForm || current.subject}` : '경로를 계산하고 있어요'] })],
              Text({ color: LABEL, children: [`경과 ${minutes(startedAt ? now - startedAt : 0)}`] }),
            ),
          ]
      return Box({
        width: PANEL_WIDTH,
        flexDirection: 'row',
        columnGap: 1,
        backgroundColor: SCREEN,
        children: [
          Box({
            width: TILE_WIDTH,
            paddingX: 1,
            backgroundColor: isArrived ? ARRIVE_TILE : TILE,
            children: [Raster({ key: 'sign', ...(isArrived ? flag : arrow(isRerouting ? 'reroute' : 'straight')) })],
          }),
          Box({ flexDirection: 'column', flexGrow: 1, paddingRight: 1, children: info }),
        ],
      })
    }

    const navi =
      panel() ??
      (stops.length === 0 && arrived
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
          }))

    const below = await next(e)
    return below ? Box({ flexDirection: 'column', children: [navi, below] }) : navi
  })
}
