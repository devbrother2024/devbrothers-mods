import type { Register } from 'claude-code'

type Camera = { label: string; note: string; say: string; matches: (command: string) => boolean }
type Catch = { at: number; label: string; command: string; decision?: '통과' | '정차' }

const SHUTTER = 'sounds/shutter.wav'
const GO = '가주세요'
const STOP = '세워주세요'
const FLASH_MS = 5_000
const SPEAK_AFTER_SHUTTER_MS = 300
const HISTORY = 20
const RED = '#ff3b30'
const GREEN = '#34c759'

const segments = (command: string) => command.split(/&&|\|\||[;|\n]/).map((part) => part.trim().split(/\s+/))

const gitSubcommand = (words: string[]) => {
  const git = words.indexOf('git')
  if (git < 0) return -1
  for (let i = git + 1; i < words.length; i++) {
    if (words[i] === '-C' || words[i] === '-c') i++
    else if (!words[i].startsWith('-')) return i
  }
  return -1
}

const isForcePush = (command: string) =>
  segments(command).some((words) => {
    const push = gitSubcommand(words)
    if (push < 0 || words[push] !== 'push') return false
    return words
      .slice(push + 1)
      .some(
        (word) =>
          /^--force(?:-with-lease|-if-includes)?(?:=|$)/.test(word) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(word) || /^\+\S+/.test(word),
      )
  })

const isRecursiveForceRm = (command: string) =>
  segments(command).some((words) => {
    const rm = words.findIndex((word) => word === 'rm' || word.endsWith('/rm'))
    if (rm < 0) return false
    const flags = words.slice(rm + 1).filter((word) => word.startsWith('-'))
    const has = (short: RegExp, long: string) => flags.some((flag) => flag === long || (/^-[a-zA-Z]+$/.test(flag) && short.test(flag)))
    return has(/[rR]/, '--recursive') && has(/f/, '--force')
  })

const DATABASE =
  /\b(?:drop\s+(?:table|database|schema)|truncate\s+(?:table\s+)?\w)|\bdelete\s+from\s+[\w."`]+\s*(?:;|$|["'])|\bprisma\s+(?:migrate\s+reset|db\s+push\s+--force-reset)|\brails\s+db:(?:drop|reset)|\bdropdb\b/i

const DISCARD =
  /\bgit\b(?:\s+-C\s+\S+)?\s+(?:reset\s+(?:\S+\s+)*--hard|clean\s+-[a-zA-Z]*f|checkout\s+(?:-f\s+)?(?:--\s+)?\.(?:\s|$)|restore\s+(?:--\S+\s+)*\.(?:\s|$)|stash\s+(?:drop|clear))/

const DEPLOY =
  /(?:^|\s)--prod(?:\s|=|$)|\bterraform\s+(?:apply|destroy)\b|\b(?:npm|pnpm|yarn)\s+publish\b|\b(?:wrangler|fly|flyctl|firebase)\s+deploy\b|\bkubectl\b[^\n;&|]*\b(?:apply|delete|rollout)\b[^\n;&|]*\bprod/

const CAMERAS: readonly Camera[] = [
  { label: '역주행 감지', note: '원격 브랜치 히스토리를 덮어씁니다', say: '역주행 차량이 감지되었습니다.', matches: isForcePush },
  { label: '낭떠러지 주의', note: '파일을 휴지통 없이 통째로 지웁니다', say: '전방 낭떠러지 주의.', matches: isRecursiveForceRm },
  { label: '어린이 보호구역', note: '데이터베이스의 데이터를 지웁니다', say: '어린이 보호구역입니다. 속도를 줄이세요.', matches: (c) => DATABASE.test(c) },
  { label: '후진 주의', note: '커밋하지 않은 변경을 버립니다', say: '후진 주의.', matches: (c) => DISCARD.test(c) },
  { label: '고속도로 진입', note: '운영 환경에 바로 반영합니다', say: '고속도로에 진입합니다.', matches: (c) => DEPLOY.test(c) },
]

const pad = (n: number) => String(n).padStart(2, '0')
const clockOf = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const short = (command: string) => (command.length > 72 ? `${command.slice(0, 71)}…` : command)

export const register: Register = (on, options) => {
  const mode = options.mode === 'block' ? 'block' : 'ask'
  const sound = options.sound !== false
  const voice = options.voice !== false
  const voiceName =
    typeof options.voice_name === 'string' && options.voice_name.trim() ? options.voice_name.trim() : 'Yuna'

  const caught: Catch[] = []
  let flash: Catch | undefined
  let flashTimer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'speedcam', description: '과속 단속 카메라: 이번 세션 단속 기록', immediate: true })
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const camera = CAMERAS.find((candidate) => candidate.matches(e.command))
    if (!camera) return next(e)

    const record: Catch = { at: await $.clock.now(), label: camera.label, command: e.command }
    caught.push(record)
    if (caught.length > HISTORY) caught.shift()
    flashTimer?.cancel()
    flash = record
    $.ui.invalidate('ui.render')

    if (sound) $.audio.play({ asset: SHUTTER }).catch(() => {})
    if (voice) {
      const line = camera.say
      $.clock.after(sound ? SPEAK_AFTER_SHUTTER_MS : 0, () => $.audio.speak(line, { voice: voiceName }).catch(() => {}))
    }

    let answer = STOP
    if (mode === 'ask') {
      try {
        answer = await $.ui.ask(`📸 찰칵! [${camera.label}] ${camera.note}. 그대로 갈까요?\n$ ${short(e.command)}`, [GO, STOP])
      } catch {}
    }
    record.decision = answer === GO ? '통과' : '정차'
    flashTimer = $.clock.after(FLASH_MS, () => {
      flash = undefined
      $.ui.invalidate('ui.render')
    })
    $.ui.invalidate('ui.render')

    if (record.decision === '통과') return next(e)
    return {
      deny:
        `과속 단속 카메라(taxi-speedcam)에서 차를 세웠어요: [${camera.label}] ${camera.note}. ` +
        '이 명령은 실행되지 않았습니다. 같은 명령을 다시 시도하지 말고, 더 안전한 방법을 제안하거나 사용자에게 먼저 물어보세요.',
    }
  })

  on('command.run', { command: 'speedcam' }, async () => {
    if (caught.length === 0) return { text: '📸 이번 세션 단속 기록이 없어요. 안전 운전 중이에요.' }
    const passed = caught.filter((record) => record.decision === '통과').length
    return {
      text: [
        `📸 단속 ${caught.length}회 · 통과 ${passed} · 정차 ${caught.length - passed}`,
        ...caught.map((record) => `${clockOf(record.at)} [${record.label}] ${record.decision ?? '대기'} · ${short(record.command)}`),
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !flash) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const status = flash.decision
      ? Text({ bold: true, color: flash.decision === '통과' ? GREEN : RED, children: [flash.decision === '통과' ? '통과했어요' : '정차했어요'] })
      : Text({ bold: true, color: RED, children: ['단속 중'] })
    const camera = Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ bold: true, color: RED, children: [`📸 [${flash.label}]`] }),
        status,
        Text({ dimColor: true, wrap: 'truncate-end', children: [short(flash.command)] }),
      ],
    })
    const below = await next(e)
    return below ? Box({ flexDirection: 'column', children: [camera, below] }) : camera
  })
}
