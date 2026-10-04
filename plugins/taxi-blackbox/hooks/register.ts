import type { Register } from 'claude-code'

type Outcome = 'ok' | 'error' | 'denied'
type Frame = { at: number; tool: string; what: string; outcome: Outcome; reason?: string; agentId?: string }

const PANE = 'taxi-blackbox'
const CAPACITY = 500
const RED = '#ff3b30'
const YELLOW = '#ffcc00'
const GREEN = '#34c759'
const OSD = '#1c1c1e'
const OSD_TEXT = '#e5e5e5'
const INK = '#111111'

const TRACK_RGB = 0x111111
const RAIL_RGB = 0x3a3a3c
const OK_RGB = 0x8e8e93
const WINDOW_RGB = 0xf2f2f7
const INCIDENT_RGB = 0xff3b30
const PICK_RGB = 0xffcc00

const TOOL_COLOR: Record<string, string> = {
  Bash: '#ff9f0a',
  Edit: '#0a84ff',
  Write: '#0a84ff',
  NotebookEdit: '#0a84ff',
  Read: '#8e8e93',
  Grep: '#8e8e93',
  Glob: '#8e8e93',
  WebFetch: '#30b0c7',
  WebSearch: '#30b0c7',
}
const OTHER_TOOL = '#bf5af2'

const SECRETS: readonly [RegExp, string][] = [
  [/\b((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi, '$1•••'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1•••'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-•••'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh•••'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, 'xox•••'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA•••'],
]

const mask = (text: string) => SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const pad = (n: number) => String(n).padStart(2, '0')
const clockOf = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const stampOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${clockOf(ms)}`
}
const elapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const body = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return h > 0 ? `${h}:${body}` : body
}

const describe = (e: Record<string, unknown>) => {
  for (const field of ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'subject', 'prompt']) {
    const value = e[field]
    if (typeof value === 'string' && value) return value
  }
  const question = Array.isArray(e.questions) ? (e.questions[0] as { question?: unknown } | undefined)?.question : undefined
  return typeof question === 'string' ? question.split('\n')[0] : ''
}

const base64 = (bytes: Uint8Array) => {
  const native = bytes as Uint8Array & { toBase64?: () => string }
  if (native.toBase64) return native.toBase64()
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const columnOf = (index: number, count: number, width: number) =>
  count <= width ? index : Math.floor((index * width) / count)

const timeline = (frames: Frame[], width: number, window: [number, number] | undefined, pick: number | undefined) => {
  const cells = Array.from({ length: width }, () => ({ glyph: '▁', rgb: RAIL_RGB, rank: 0 }))
  frames.forEach((frame, i) => {
    const column = columnOf(i, frames.length, width)
    const [glyph, rgb, rank] =
      i === pick
        ? ['█', PICK_RGB, 4]
        : frame.outcome !== 'ok'
          ? ['█', INCIDENT_RGB, 3]
          : window && i >= window[0] && i < window[1]
            ? ['▆', WINDOW_RGB, 2]
            : ['▄', OK_RGB, 1]
    if (rank > cells[column].rank) cells[column] = { glyph, rgb, rank }
  })
  const numbers = cells.flatMap((cell) => [cell.glyph.codePointAt(0) ?? 32, cell.rgb, TRACK_RGB])
  return { columns: width, rows: 1, cells: base64(new Uint8Array(Uint32Array.from(numbers).buffer)) }
}

const reasonOf = (out: { deny?: string; isError?: boolean; result?: unknown }) => {
  if (out.deny) return out.deny
  if (!out.isError) return undefined
  return typeof out.result === 'string' ? out.result : JSON.stringify(out.result ?? '')
}

export const register: Register = (on, options) => {
  const before = typeof options.before === 'number' && options.before >= 1 ? Math.floor(options.before) : 5

  const frames: Frame[] = []
  let dropped = 0
  let startedAt = 0
  let blink = true
  let isDriving = false
  let clock: { cancel: () => void } | undefined
  let selected: number | undefined

  const incidents = () => frames.flatMap((frame, i) => (frame.outcome === 'ok' ? [] : [i]))

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'blackbox', description: '블랙박스: 사고(오류·거부) 직전 동작 돌려보기', immediate: true })
    startedAt = await $.clock.now()
    clock?.cancel()
    clock = $.clock.every(1000, () => {
      blink = isDriving ? !blink : true
      $.ui.invalidate('ui.render')
    })
    return result
  })

  on('session.end', async ($, e, next) => {
    clock?.cancel()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isDriving = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!(e as { agentId?: string }).agentId) {
      isDriving = false
      blink = true
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const frame: Frame = {
      at,
      tool: e.tool,
      what: oneLine(mask(describe(e as unknown as Record<string, unknown>)), 90),
      outcome: 'ok',
      ...(e.agentId ? { agentId: e.agentId } : {}),
    }
    const keep = () => {
      frames.push(frame)
      if (frames.length > CAPACITY) {
        frames.shift()
        dropped += 1
      }
      $.ui.invalidate('ui.render')
    }
    try {
      const out = await next(e)
      const reason = reasonOf(out)
      if (out.deny) frame.outcome = 'denied'
      else if (out.isError) frame.outcome = 'error'
      if (reason) frame.reason = oneLine(mask(reason), 160)
      keep()
      return out
    } catch (error) {
      frame.outcome = 'error'
      frame.reason = oneLine(mask(String(error)), 160)
      keep()
      throw error
    }
  })

  on('command.run', { command: 'blackbox' }, async ($) => {
    selected = undefined
    await $.ui.open({ id: PANE, title: '블랙박스', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || startedAt === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const count = incidents().length
    const rec = Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ bold: true, color: blink ? '#ffffff' : RED, backgroundColor: blink ? RED : OSD, children: [' ● REC '] }),
        Text({ color: OSD_TEXT, backgroundColor: OSD, children: [` ${stampOf(now)} `] }),
        Text({ dimColor: true, children: [`${elapsed(now - startedAt)} · 기록 ${frames.length + dropped}`] }),
        ...(count > 0 ? [Text({ bold: true, color: INK, backgroundColor: YELLOW, children: [` 사고 ${count} `] })] : []),
        Text({ dimColor: true, children: ['/blackbox'] }),
      ],
    })
    const above = await next(e)
    return above ? Box({ flexDirection: 'column', children: [above, rec] }) : rec
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const redraw = () => $.ui.invalidate('ui.render')
    const list = incidents()
    const pick = list.length === 0 ? undefined : Math.min(selected ?? list.length - 1, list.length - 1)
    const width = Math.max(20, e.props.bodyColumns - 4)

    const fixed = (child: ReturnType<typeof Text>) => Box({ flexShrink: 0, children: [child] })
    const fill = (child: ReturnType<typeof Text>) => Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [child] })
    const isWide = e.props.bodyColumns >= 60

    const badge = (frame: Frame, isIncident: boolean) =>
      Text({
        bold: true,
        color: INK,
        backgroundColor: isIncident ? RED : (TOOL_COLOR[frame.tool] ?? OTHER_TOOL),
        children: [` ${frame.agentId ? '↳ ' : ''}${frame.tool} `],
      })

    const line = (frame: Frame, isIncident: boolean) =>
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          fixed(Text({ dimColor: true, children: [clockOf(frame.at)] })),
          fixed(badge(frame, isIncident)),
          fill(Text({ wrap: 'truncate-end', ...(isIncident ? { bold: true } : { dimColor: true }), children: [frame.what || '-'] })),
        ],
      })

    const scrubber = (window: [number, number] | undefined, at: number | undefined) => {
      if (!('Raster' in elements) || frames.length === 0) return []
      const caret = at === undefined ? [] : [Text({ color: YELLOW, bold: true, children: [`${' '.repeat(columnOf(at, frames.length, width))}▲`] })]
      return [elements.Raster({ key: 'timeline', ...timeline(frames, width, window, at) }), ...caret]
    }

    const header = (mode: 'REC' | 'PLAY', title: string, stamp: number) =>
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          fixed(
            Text({
              bold: true,
              color: mode === 'REC' ? '#ffffff' : INK,
              backgroundColor: mode === 'REC' ? RED : GREEN,
              children: [mode === 'REC' ? ' ● REC ' : ' ▶ PLAY '],
            }),
          ),
          fill(Text({ bold: true, wrap: 'truncate-end', children: [title] })),
          fixed(Text({ color: OSD_TEXT, backgroundColor: OSD, children: [` ${isWide ? stampOf(stamp) : clockOf(stamp)} `] })),
        ],
      })

    if (pick === undefined) {
      return Box({
        flexDirection: 'column',
        paddingX: 1,
        children: [
          header('REC', `블랙박스 · 기록 ${frames.length + dropped} · 사고 없음`, await $.clock.now()),
          Text({ dimColor: true, children: ['오류나 거부가 생기면 그 직전 동작을 여기서 돌려볼 수 있어요. 최근 동작:'] }),
          ...scrubber([Math.max(0, frames.length - before), frames.length], undefined),
          ...frames.slice(-before).map((frame) => line(frame, false)),
        ],
      })
    }

    const at = list[pick]
    const incident = frames[at]
    const label = incident.outcome === 'denied' ? '거부' : '오류'
    return Box({
      flexDirection: 'column',
      paddingX: 1,
      children: [
        header('PLAY', `사고 ${pick + 1}/${list.length} · ${incident.tool} ${label}`, incident.at),
        ...scrubber([Math.max(0, at - before), at], at),
        Text({ dimColor: true, children: [`직전 ${before}개 동작`] }),
        ...frames.slice(Math.max(0, at - before), at).map((frame) => line(frame, false)),
        Box({
          flexDirection: 'column',
          borderStyle: 'round',
          borderColor: RED,
          paddingX: 1,
          children: [
            fixed(Text({ bold: true, color: '#ffffff', backgroundColor: RED, children: [' 사고 장면 '] })),
            line(incident, true),
            Text({ color: RED, wrap: 'wrap', children: [`└ ${incident.reason ?? label}`] }),
          ],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({
              key: 'prev',
              label: '◀ 이전 사고',
              hotkey: 'p',
              dimColor: pick === 0,
              onPress: () => {
                selected = Math.max(0, pick - 1)
                redraw()
              },
            }),
            Button({
              key: 'next',
              label: '다음 사고 ▶',
              hotkey: 'n',
              dimColor: pick === list.length - 1,
              onPress: () => {
                selected = Math.min(list.length - 1, pick + 1)
                redraw()
              },
            }),
          ],
        }),
      ],
    })
  })
}
