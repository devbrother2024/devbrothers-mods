# devbrothers-mods

개발동생이 만든 Claude Code mods 모음입니다. 첫 번째 묶음은 **택시 팩**이에요.

| mod | 하는 일 | 명령 |
| --- | --- | --- |
| `taxi-meter` | 프롬프트 위에 실제 택시 미터기 모양의 패널을 띄웁니다. 이번 승차(프롬프트) 요금(API 정가 환산 원화), 5시간·주간 한도와 리셋 시각, 차종·할증·복합 키를 보여줍니다. | `/meter`, `/meter reset`, `/meter demo`, `/receipt` |
| `taxi-navi` | Claude의 할 일 목록을 내비 경로로 그립니다. 계획이 바뀌면 "경로를 재탐색합니다", 다 끝나면 도착 안내를 합니다. | `/navi` |
| `taxi-speedcam` | 위험한 Bash 명령 앞에서 찰칵 잡고 [가주세요]/[세워주세요]로 묻습니다. | `/speedcam` |
| `taxi-blackbox` | 도구 호출을 녹화합니다. 오류·거부(사고)가 나면 직전 동작을 돌려볼 수 있어요. | `/blackbox` |

Claude Code 2.1.289에서 만들고 테스트했습니다.

## 설치

```bash
claude plugin marketplace add devbrother2024/devbrothers-mods
claude plugin install taxi-blackbox@devbrothers-mods
claude plugin install taxi-speedcam@devbrothers-mods
claude plugin install taxi-meter@devbrothers-mods
claude plugin install taxi-navi@devbrothers-mods
```

하나만 골라 설치해도 됩니다. 넷 다 쓴다면 블랙박스를 먼저 설치하세요. Claude Code는 설치한 순서대로 mod를 불러오는데, 블랙박스가 단속 카메라보다 앞에 있어야 단속 카메라가 세운 명령까지 기록돼요. 설정은 따로 하지 않아도 기본값으로 동작합니다.

설치 전에 한 세션만 써보고 싶다면 저장소를 받아서 `--plugin-dir`로 띄워보세요.

```bash
git clone https://github.com/devbrother2024/devbrothers-mods
cd devbrothers-mods
claude --plugin-dir plugins/taxi-blackbox --plugin-dir plugins/taxi-speedcam --plugin-dir plugins/taxi-meter --plugin-dir plugins/taxi-navi
```

`--plugin-dir` 순서가 실행 순서입니다. 블랙박스를 맨 앞에 두어야 단속 카메라가 세운 명령까지 기록돼요.

## 택시 팩 자세히

### taxi-meter

```
╭────────────────────────────────────────────────────────────────────╮
│ 클로드·택시+   모범   41.3 tok/s              ELECTRONIC TAXIMETER │
│ ▄█▄                     ▟▀▀▜▖▟▀▀▜▖  ▟▀▀▜▖█▀▀▀▘▟▀▀▜▖                │
│ ▀▝█▙      ▖              ▗▄▟▘█  ▐▌    ▗▟▘█▄▄▄ █  ▐▌ 원    61%      │
│    ▜██████▀                ▐▌█  ▐▌▗▖▗▟▀     ▐▌█  ▐▌ (WON) 컨텍스트 │
│    █▐▌ █▐▌              ▜▄▄▟▘▜▄▄▟▘▟▘█▄▄▄▖▜▄▄▟▘▜▄▄▟▘                │
│  주행  5시간 ████████░░ 88% · 20:00 리셋 │ 주간 28%                │
│   빈차     주행     할증     복합     지불               데모 주행 │
╰────────────────────────────────────────────────────────────────────╯
```

- 요금은 쓴 토큰을 **API 정가로 환산한 금액**입니다. 구독(Pro·Max) 요금제에서 실제로 청구되는 돈이 아니에요.
- 프롬프트 하나가 승차 한 번입니다. 새 프롬프트를 보내면 0원에서 다시 셉니다(`/clear` 뒤도 같음). 세션 합계는 `/meter`와 `/receipt`에서 볼 수 있어요.
- 실제 미터기처럼 생긴 패널입니다. 말은 응답 중에 달리고, 위쪽에 차종과 출력 속도(tok/s), 오른쪽에 컨텍스트 사용률이 나와요.
- 아래 키는 상태에 따라 켜집니다. `빈차` 시작 전, `주행` 응답 중, `할증` Opus·Fable 사용, `복합` 컨텍스트 50% 이상(장거리), `지불` 응답이 끝나 요금이 확정됐거나 한도 소진. 차종은 Sonnet·Haiku `일반`, Opus `모범`, Fable `블랙`입니다.
- 패널은 터미널 폭 75칸·높이 9줄 이상에서 나오고, 그보다 좁거나 데스크톱 앱이면 한 줄 표시로 바뀝니다.
- 5시간 한도가 90%를 넘으면 "곧 목적지입니다", 100%면 "하차하셔야 합니다 · 리셋 시각 재승차"로 바뀌고 알림음이 한 번 울립니다. 한도를 다 쓰면 요금 숫자가 빨간색이 돼요.
- `/meter`는 이번 승차·이번 세션·오늘·최근 7일·누적 요금을 보여주고, `/receipt`는 영수증 창을 엽니다. 누적 장부는 세션을 넘어 90일치를 보관합니다. `/meter reset`은 화면 요금과 누적 장부를 모두 0원으로 만들고, 데모 주행 중이면 데모도 끝내요.
- `/meter demo`는 촬영·시연용 데모 주행입니다. 실제 사용량과 상관없는 연출 숫자로 약 10초 동안 승차부터 하차까지 보여주고, 미터기에 "데모 주행"이라고 표시돼요. 한 번 더 입력하거나 다음 프롬프트를 보내면 실제 미터기로 돌아옵니다.

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `krw_per_usd` | 1400 | 원화 환산 환율 |
| `style` | `led` | `led`는 터미널에서 미터기 패널, `compact`는 한 줄 |
| `sound` | `true` | 요금이 오를 때 딸깍, 한도 경고 알림음 |
| `tick_won` | 1000 | 딸깍 소리를 내는 금액 단위 |

### taxi-navi

```
🧭 ●━━●━━◉──○──○  2/5
지금 테스트 작성 중 · 다음 안내 문서 정리
```

- Claude Code v2.1.233부터 Opus 4.8·Sonnet 5·Fable 5 이후 모델은 할 일 도구가 기본으로 꺼져 있습니다. 이 모델들에서는 Claude가 할 일 목록을 만들지 않아서 내비에 그릴 경로가 없어요. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1 claude`로 시작하세요. 켜져 있는지는 `/navi`가 알려줍니다.
- `TaskCreate`·`TaskUpdate`·`TaskList`와 `TodoWrite`를 읽기만 합니다. 할 일 내용은 바꾸지 않아요.
- 첫 작업이 시작될 때 "경로 안내를 시작합니다", 진행 중에 할 일이 늘거나 줄면 "경로를 재탐색합니다", 모두 끝나면 "목적지에 도착했습니다"라고 말합니다.
- 서브에이전트의 할 일은 경로에 넣지 않습니다.

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `voice` | `true` | 음성 안내 |
| `voice_name` | `Yuna` | macOS `say -v '?'`에 나오는 음성 이름 |
| `sound` | `true` | 할 일 하나를 끝낼 때마다 딩 |

### taxi-speedcam

| 단속 | 잡는 명령 예시 |
| --- | --- |
| 역주행 감지 | `git push --force`, `git push -f`, `git push origin +main` |
| 낭떠러지 주의 | `rm -rf`, `rm -r -f`, `rm --recursive --force` |
| 어린이 보호구역 | `DROP TABLE`, `TRUNCATE`, WHERE 없는 `DELETE FROM`, `prisma migrate reset` |
| 후진 주의 | `git reset --hard`, `git clean -f`, `git checkout -- .`, `git stash drop` |
| 고속도로 진입 | `--prod`, `wrangler deploy`, `terraform apply`, `npm publish` |

- [가주세요]를 고르면 평소처럼 권한 확인을 거쳐 실행되고, [세워주세요]를 고르면 실행하지 않고 Claude에게 이유를 알려줍니다.
- 질문을 닫거나 `claude -p`처럼 물어볼 사람이 없으면 세웁니다.
- 패턴으로 잡는 안전벨트입니다. 보안 경계가 아니니 권한 설정(deny 규칙)을 대신하지 않아요.

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `mode` | `ask` | `ask`는 매번 묻고, `block`은 묻지 않고 세웁니다 |
| `sound` | `true` | 찰칵 셔터 소리 |
| `voice` | `true` | 단속 종류 음성 안내 |
| `voice_name` | `Yuna` | macOS 음성 이름 |

### taxi-blackbox

```
● REC 12:34 · 기록 128 사고 2 · /blackbox
```

- 모든 도구 호출의 시각, 도구, 대상(명령·파일·URL)과 결과(정상·오류·거부)를 이번 세션 동안 최대 500개 기억합니다.
- `/blackbox`는 사고 직전 동작을 보여주는 창을 엽니다. `p`·`n`으로 이전·다음 사고를 넘겨보세요.
- `token=`, `password=`, `Bearer`, `sk-`, `ghp_`, `xoxb-`, `AKIA` 형태의 값은 `•••`로 가려서 기록합니다. 기록은 메모리에만 두고 파일로 저장하지 않습니다.

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `before` | 5 | 사고 하나와 함께 보여줄 직전 동작 수 |

## 알아두면 좋은 점

- mods는 샌드박스 없이 Claude Code 안에서 실행됩니다. 어떤 mod든 설치 전에 코드를 읽어보세요. 이 팩은 `$.fs`, `$.process`, `$.http`를 쓰지 않습니다. `claude plugin validate plugins/<이름>`의 `calls:` 줄로 직접 확인할 수 있어요.
- 소리와 음성은 macOS에서만 납니다. Linux와 Windows에서는 화면 표시만 동작해요.
- 설정은 `/config`에서 바꿀 수 있습니다.

## 개발

```bash
claude plugin validate plugins/taxi-meter
claude plugin test plugins/taxi-meter
python3 scripts/make-sounds.py
```

효과음은 `scripts/make-sounds.py`가 직접 합성한 파일이라 외부 음원 라이선스가 없습니다.

## 라이선스

MIT. 자세한 내용은 [LICENSE](LICENSE)를 보세요.
