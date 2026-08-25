<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../public/icon-dark.svg" />
  <img src="../public/icon.svg" alt="Busabase" width="96" height="96" />
</picture>

<h1>Busabase</h1>

<p><b>AI 에이전트를 위한 데이터베이스 &amp; 워크스페이스</b><br/>
Claude Code, Codex, Cursor, OpenClaw와 자체 에이전트가 구조화된 데이터, 지속 가능한 지식, 재사용 가능한 Skill, 실행 가능한 앱, 사람의 검토를 한곳에서 사용하게 합니다.</p>

<p>
<a href="../README.md">English</a> &nbsp;·&nbsp; <a href="./README_zh-CN.md">中文</a> &nbsp;·&nbsp; <a href="./README_ja.md">日本語</a> &nbsp;·&nbsp; <b>한국어</b>
</p>

<p>
<a href="https://www.npmjs.com/package/busabase"><img src="https://img.shields.io/npm/v/busabase?logo=npm&label=busabase&color=3fb950" alt="npm busabase" /></a>
<a href="https://hub.docker.com/r/busabase/busabase"><img src="https://img.shields.io/docker/image-size/busabase/busabase/latest?logo=docker&label=docker" alt="Docker image" /></a>
<a href="https://busabase.com/download"><img src="https://img.shields.io/badge/Desktop-Download-1f6feb?logo=tauri&logoColor=white" alt="Busabase Desktop" /></a>
<a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
<a href="https://github.com/busabase/busabase/stargazers"><img src="https://img.shields.io/github/stars/busabase/busabase?style=social" alt="GitHub stars" /></a>
</p>

<br/>

<img src="../public/assets/readme/busabase-hero.webp" alt="Busabase에서 데이터, 지식, Skill, 앱을 사용하는 AI 에이전트" width="100%" />

</div>

AI 에이전트는 코드를 작성하고 결과물을 만들 수 있지만, 유용한 작업은 채팅, 파일, 데이터베이스, SaaS 도구에 흩어지기 쉽습니다. 다음 실행에서는 맥락을 다시 찾아야 하고, 에이전트가 무엇을 왜 바꿨는지 사람에게 잘 보이지 않습니다.

**Busabase는 또 하나의 채팅 창이 아니라 에이전트가 실제로 일하는 워크스페이스입니다.**

- **에이전트를 위한 데이터베이스**: Base, 필드, 레코드, 관계, 뷰, 폼, 에셋.
- **에이전트를 위한 지식 베이스**: Doc, File, Drive, 검색, 이력, 출처 추적.
- **에이전트를 위한 워크스페이스**: Skill, AirApp, Whiteboard, Workflow, Agents, 공유 활동.
- **에이전트 작업의 신뢰 계층**: Change Request, 필드 단위 diff, 댓글, 승인, commit, 감사 로그.

에이전트는 사람이 보는 동일한 워크스페이스를 읽고, 지식과 Skill을 사용하며, 데이터 위에 앱을 만들고, 개선안을 다시 제안할 수 있습니다. 중요한 쓰기는 Change Request로 도착하여 사람이 확인한 뒤에만 공식 데이터가 됩니다.

**무료 오픈소스. 로컬 우선. 에이전트 네이티브. 모든 중요한 변경을 검토 가능.**

## 빠른 시작

```bash
npx busabase server
```

**http://localhost:15419/dashboard/local** 을 여세요. 외부 데이터베이스, 계정, 추가 설정이 필요하지 않습니다. 내장 PGlite, 로컬 파일 저장소, 데모 워크스페이스로 시작합니다.

```bash
npm i -g busabase
npx busabase-cli --help
```

### Docker

```bash
docker run --rm -p 15419:15419 -v ~/.busabase/data:/data busabase/busabase
```

### 데스크톱 앱

macOS, Windows, Linux 앱은 **[busabase.com/download](https://busabase.com/download)** 에서 받을 수 있습니다. Personal Desktop은 로컬에서 실행되고 오프라인으로도 사용할 수 있습니다.

### 소스에서 실행

```bash
pnpm install
cp apps/busabase/.env.example apps/busabase/.env
pnpm --filter busabase dev
```

CLI server와 Desktop은 기본적으로 같은 로컬 데이터 루트를 공유합니다.

```text
~/.busabase/data/
├── pgdata/   # 내장 PGlite 데이터베이스
└── storage/  # 파일과 첨부
```

## 하나의 워크스페이스, 다양한 구성 요소

Busabase는 "AI 버튼이 붙은 데이터베이스"가 아닙니다. 모든 구성 요소가 같은 워크스페이스의 일급 노드이며, 사람, 에이전트, MCP, OpenAPI가 같은 대상을 다룹니다.

| 구성 요소 | 에이전트가 얻는 것 | 사람이 얻는 것 |
| --- | --- | --- |
| **Base** | 구조화 레코드, schema, 관계, 필터, 뷰 | 채팅 기억이 아닌 실제 운영 데이터베이스 |
| **Doc** | 지속 가능한 Markdown 지식과 운영 지침 | 편집, 버전 관리, 추적이 가능한 지식 |
| **File / Drive** | 파일, 첨부, 프로젝트 트리 | 에이전트 작업의 근거를 한곳에 보관 |
| **Skill** | 지침, 참고 자료, 예제, 스크립트 | 워크스페이스 맥락과 함께 재사용되는 능력 |
| **AirApp** | 워크스페이스 데이터와 API 기반 앱 | 새 데이터 사일로를 만들지 않는 전용 UI |
| **Whiteboard / Workflow** | 시각적 맥락과 실행 가능한 프로세스 | 에이전트도 이해하고 개선하는 공유 계획 |
| **Inbox / Activity** | 제안된 변경과 워크스페이스 이벤트 | 사람의 통제, 복구 경로, 완전한 감사 기록 |

현재 노드 유형은 Folder, Base, Doc, File, Drive, Skill, AirApp, Form, HTML, Whiteboard, Workflow입니다. 자세한 내용은 **[Node Types](./node-types.md)** 를 참고하세요.

## 워크스페이스 화면

<img src="../public/assets/readme/busabase-workspace-home.webp" alt="검토 큐, 최근 지식, 에이전트 활동이 보이는 Busabase 홈" width="100%" />

|  |  |
| :---: | :---: |
| ![에이전트를 위한 구조화 Base](../public/assets/readme/busabase-base-table.webp) | ![에이전트의 지속 가능한 Doc](../public/assets/readme/busabase-doc-detail.webp) |
| **Database**: 타입, 관계, 검색을 갖춘 레코드 | **Knowledge base**: 버전 이력이 있는 지속 가능한 Doc |
| ![재사용 가능한 Agent Skill](../public/assets/readme/busabase-skill-detail.webp) | ![워크스페이스의 AirApp](../public/assets/readme/busabase-apps-gallery.webp) |
| **Skills**: 재사용 가능한 지침과 관련 파일 | **Apps**: 동일한 데이터 위에 만든 전용 인터페이스 |
| ![제품 출시 Whiteboard](../public/assets/readme/busabase-whiteboard.webp) | ![리드 접수 Workflow](../public/assets/readme/busabase-workflow.webp) |
| **Whiteboards**: 사람과 에이전트의 시각적 맥락 | **Workflows**: 데이터와 지식 옆에 보관되는 프로세스 |
| ![에이전트 제안의 필드 diff](../public/assets/readme/busabase-agent-output-preview.webp) | ![레코드 이력과 감사 로그](../public/assets/readme/busabase-record-detail-audit.webp) |
| **Review**: merge 전에 변경 내용을 확인 | **Provenance**: 출처, reviewer, commit, 이력을 보존 |

## 에이전트 연결

Busabase는 모델을 내장하지 않습니다. Claude Code, Codex, Cursor, Gemini CLI, OpenClaw, Hermes, Buda AI, n8n 또는 자체 에이전트를 연결하세요.

<details>
<summary><b>로컬 연결 프롬프트 복사</b></summary>

```text
Busabase Agent Skill을 읽고 유일한 운영 규칙으로 따르세요:
http://localhost:15419/SETUP_SKILL.md

onboarding 절차에 따라 이 워크스페이스에 연결하세요. 중요한 변경은 ChangeRequest로 제안하고, 내 승인 없이 merge하지 마세요. 한국어로 답하세요.
```

</details>

**[Claude Code 가이드](./claude-code.md)** 와 **[Bring Your Own Agent](./bring-your-agent.md)** 에 자세한 연결 절차가 있습니다.

| 연결 방식 | 적합한 용도 |
| --- | --- |
| **Agent Skill** | 워크스페이스 지침을 읽는 coding agent와 로컬 CLI |
| **MCP** | 타입이 있는 워크스페이스 도구가 필요한 agent와 IDE |
| **OpenAPI / CLI** | 앱, 스크립트, 자동화, 자체 agent |
| **Agents view (ACP)** | 도구 단계와 권한 요청이 표시되는 대화 세션 |

## 신뢰할 수 있는 결과가 되는 과정

```text
Agent가 워크스페이스 맥락을 읽음
        ↓
데이터, Doc, Skill, App 변경을 제안
        ↓
Change Request가 정확한 diff, 출처, 영향을 표시
        ↓
사람이 승인, 수정 요청, 거부
        ↓
merge된 결과가 공식 워크스페이스 지식이 됨
```

Change Request는 Busabase의 제품 범주가 아니라, 에이전트 워크스페이스를 신뢰할 수 있게 만드는 메커니즘입니다.

## Personal Desktop과 Cloud

| Personal Desktop / 로컬 | Busabase Cloud |
| --- | --- |
| 무료 오픈소스 | 호스팅된 다중 사용자 워크스페이스 |
| 로컬 PGlite와 파일 | 관리형 Postgres와 객체 저장소 |
| 로그인 불필요 | 인증, Space, 역할, 권한 |
| 오프라인 지원 | 협업, 호스팅 API, 거버넌스 |
| 데이터가 기기에 유지 | Web과 모바일에서 접근 |

**Cloud Connect** 는 인증된 tunnel로 로컬 워크스페이스를 [Busabase Cloud](https://busabase.com)에 연결합니다. 데이터와 로컬 에이전트는 기기에 남고, Cloud와 모바일은 통제된 원격 화면이 됩니다.

## API와 아키텍처

Busabase는 **MCP**, **OpenAPI**, `busabase-cli` 를 통해 전체 워크스페이스를 제공합니다.

```text
http://localhost:15419/api/v1/doc
```

<div align="center">
  <img src="../public/architecture-diagram.svg" alt="Busabase 아키텍처" width="100%">
</div>

`apps/busabase`는 로컬 단일 워크스페이스 Next.js shell입니다. 공유 엔진은 `packages/busabase-core`에 있으며, [Busabase Cloud](https://busabase.com)도 같은 core에 인증, 권한, 호스팅 저장소, 협업을 더해 사용합니다.

## 보안

오픈소스 server는 신뢰할 수 있는 로컬 환경이나 사설 네트워크용입니다. 인증과 reverse proxy 없이 쓰기 endpoint를 공개 인터넷에 직접 노출하지 마세요.

## 기여하기

```bash
pnpm install
pnpm --filter busabase dev
pnpm --filter busabase typecheck
pnpm --filter busabase lint:err
```

[Issues](https://github.com/busabase/busabase/issues)와 [Discussions](https://github.com/busabase/busabase/discussions)에서 버그, 아이디어, PR을 환영합니다.

## License

[MIT](../../../LICENSE) © Busabase
