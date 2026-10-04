import type { Register } from 'claude-code'

type Outcome = 'ok' | 'error' | 'denied'
type Frame = { at: number; tool: string; what: string; outcome: Outcome; reason?: string; agentId?: string }

const PANE = 'taxi-blackbox'
const CAPACITY = 500
const RED = '#ff3b30'
const YELLOW = '#ffcc00'

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
  let blinkTimer: { cancel: () => void } | undefined
  let selected: number | undefined

  const incidents = () => frames.flatMap((frame, i) => (frame.outcome === 'ok' ? [] : [i]))

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'blackbox', description: '블랙박스: 사고(오류·거부) 직전 동작 돌려보기', immediate: true })
    startedAt = await $.clock.now()
    return result
  })

  on('session.end', async ($, e, next) => {
    blinkTimer?.cancel()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    blinkTimer?.cancel()
    blinkTimer = $.clock.every(1000, () => {
      blink = !blink
      $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!(e as { agentId?: string }).agentId) {
      blinkTimer?.cancel()
      blinkTimer = undefined
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
        Text({ bold: true, ...(blink ? { color: RED } : { dimColor: true }), children: ['● REC'] }),
        Text({ dimColor: true, children: [`${elapsed(now - startedAt)} · 기록 ${frames.length + dropped}`] }),
        ...(count > 0 ? [Text({ bold: true, color: YELLOW, children: [`사고 ${count}`] })] : []),
        Text({ dimColor: true, children: ['· /blackbox'] }),
      ],
    })
    const above = await next(e)
    return above ? Box({ flexDirection: 'column', children: [above, rec] }) : rec
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const list = incidents()
    const pick = list.length === 0 ? undefined : Math.min(selected ?? list.length - 1, list.length - 1)

    const line = (frame: Frame, isIncident: boolean) =>
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ dimColor: true, children: [clockOf(frame.at)] }),
          Text({
            ...(isIncident ? { bold: true, color: RED } : {}),
            children: [`${frame.agentId ? '↳ ' : ''}${frame.tool}`],
          }),
          Text({ wrap: 'truncate-end', ...(isIncident ? {} : { dimColor: true }), children: [frame.what || '-'] }),
        ],
      })

    if (pick === undefined) {
      return Box({
        flexDirection: 'column',
        paddingX: 1,
        children: [
          Text({ bold: true, children: [`블랙박스 · 기록 ${frames.length + dropped} · 사고 없음`] }),
          Text({ dimColor: true, children: ['오류나 거부가 생기면 그 직전 동작을 여기서 돌려볼 수 있어요. 최근 동작:'] }),
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
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ bold: true, children: [`사고 ${pick + 1}/${list.length} · ${incident.tool} ${label}`] }),
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
        Text({ dimColor: true, children: [`직전 ${before}개 동작`] }),
        ...frames.slice(Math.max(0, at - before), at).map((frame) => line(frame, false)),
        line(incident, true),
        Text({ color: RED, wrap: 'wrap', children: [`└ ${incident.reason ?? label}`] }),
      ],
    })
  })
}
