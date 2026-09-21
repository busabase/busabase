<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../public/icon-dark.svg" />
  <img src="../public/icon.svg" alt="Busabase" width="96" height="96" />
</picture>

<h1>Busabase</h1>

<p><b>面向 AI Agent 的数据库与工作区</b><br/>
让 Claude Code、Codex、Cursor、OpenClaw 和你的自研 Agent，在同一个地方使用结构化数据、长期知识、可复用 Skill、可运行应用，以及每一次改动都查得到的历史。</p>

<p>
<a href="../README.md">English</a> &nbsp;·&nbsp; <b>中文</b> &nbsp;·&nbsp; <a href="./README_ja.md">日本語</a> &nbsp;·&nbsp; <a href="./README_ko.md">한국어</a>
</p>

<p>
<a href="https://www.npmjs.com/package/busabase"><img src="https://img.shields.io/npm/v/busabase?logo=npm&label=busabase&color=3fb950" alt="npm busabase" /></a>
<a href="https://hub.docker.com/r/busabase/busabase"><img src="https://img.shields.io/docker/image-size/busabase/busabase/latest?logo=docker&label=docker" alt="Docker image" /></a>
<a href="https://busabase.com/download"><img src="https://img.shields.io/badge/Desktop-Download-1f6feb?logo=tauri&logoColor=white" alt="下载 Busabase Desktop" /></a>
<a href="https://glama.ai/mcp/connectors/com.busabase/busabase"><img src="https://glama.ai/mcp/connectors/com.busabase/busabase/badges/score.svg" alt="Glama MCP connector score" /></a>
<a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
<a href="https://github.com/busabase/busabase/stargazers"><img src="https://img.shields.io/github/stars/busabase/busabase?style=social" alt="GitHub stars" /></a>
</p>

<br/>

<img src="../public/assets/readme/busabase-hero-zh-CN.webp" alt="AI Agent 在 Busabase 中使用数据、知识、Skill 和应用" width="100%" />

</div>

> Busabase 是面向 AI Agent 的开源数据库与工作区——agent 和人共用同一份结构化数据、文档、技能与应用，重要写入经审核成为可信记录。

AI Agent 会写代码、生成内容、执行任务，但真正有价值的结果经常散落在聊天、文件、数据库和各种 SaaS 里。下一次运行时，Agent 又要重新寻找上下文；当它写回数据时，人也很难看清它改了什么、为什么改。

**Busabase 给 Agent 一个真正的工作区，而不是又一个聊天窗口。**

- **Agent 的数据库**：Base、字段、记录、关系、视图、表单和资产。
- **Agent 的知识库**：Doc、File、Drive、搜索、历史和来源追踪。
- **Agent 的 Workspace**：Skill、AirApp、白板、工作流、Agents 和共享活动。
- **Agent 工作的信任层**：变更请求、字段级 diff、评论、审核、commit 和审计记录。

Agent 可以读取你看到的同一个工作区，使用里面的知识和 Skill，基于其中的数据构建应用，再把改进写回。每一次写入都以 Change Request 的形式发生，因此都带着说明、diff、作者和完整历史——至于是当场合并还是进收件箱等人审核，由你的工作区权限决定。

**免费开源。本地优先。Agent 原生。每一次改动都有账可查。**

## 快速开始

```bash
npx busabase server
```

打开 **http://localhost:15419/dashboard/local**。不需要外部数据库、账号或额外配置；Busabase 会使用内嵌 PGlite、本地文件存储和示例工作区启动。

```bash
npm i -g busabase       # 全局安装后直接运行：busabase server
npx busabase-cli --help # 连接任意 Busabase 服务的 API 客户端
```

### Docker

```bash
docker run --rm -p 15419:15419 -v ~/.busabase/data:/data busabase/busabase
```

### 桌面版

前往 **[busabase.com/download](https://busabase.com/download)** 下载 macOS、Windows 或 Linux 客户端。Personal Desktop 在本机运行、支持离线使用，工作区数据无需离开你的电脑。

### 从源码运行

```bash
pnpm install
cp apps/busabase/.env.example apps/busabase/.env
pnpm --filter busabase dev
```

CLI server 和 Desktop 默认共享同一份本地数据：

```text
~/.busabase/data/
├── pgdata/   # 内嵌 PGlite 数据库
└── storage/  # 文件与附件
```

可通过 `BUSABASE_DATA_DIR`、`PG_DATABASE_URL` 或 `STORAGE_URL` 切换目录、外部 Postgres 或 S3 兼容存储。

## 一个工作区，多种构件

Busabase 不是“数据库加几个 AI 按钮”。每种构件都是同一个工作区里的一级节点，人、Agent、MCP 和 OpenAPI 访问的是同一套对象。

| 构件 | Agent 得到什么 | 你得到什么 |
| --- | --- | --- |
| **Base** | 结构化记录、字段 schema、关系、筛选与视图 | 真正的业务数据库，而不是松散的聊天记忆 |
| **Doc** | 长期 Markdown 知识和操作说明 | 可编辑、可版本化、可追溯的知识 |
| **File 与 Drive** | 文件、附件和项目目录树 | Agent 工作所依赖的资料集中在一处 |
| **Skill** | 指令、参考资料、示例和脚本 | 跟随工作区上下文一起复用的能力 |
| **AirApp** | 基于工作区数据和 API 的可运行应用 | 不制造新数据孤岛的专用界面 |
| **白板与工作流** | 可视化上下文和 Agent 读得懂的流程定义 | Agent 也能理解和改进的共同计划 |
| **Inbox 与 Activity** | 待审提议和工作区事件 | 人类控制、恢复路径和完整审计轨迹 |

当前节点类型包括 Folder、Base、Doc、File、Drive、Skill、AirApp、Form、HTML、Whiteboard 和 Workflow。详见 **[节点类型](./node-types.md)**。

### 从模板开始

模板会一次性装好一个完整的工作区应用：Base、视图、Doc、示例数据、AirApp，以及告诉 Agent 这个应用该怎么用的 Skill 说明书。

```bash
busabase-cli install https://github.com/busabase/templates/tree/main/templates/busa-crm
```

模板目录在 **[busabase.com/templates](https://busabase.com/templates)**，也可以从任意 GitHub URL 或本地目录安装 Busabase package。`--dry-run` 先打印安装计划，`--require-review` 则把 package 的记录和文档留成变更请求等你确认，而不是直接合并。

## 工作区界面

<img src="../public/assets/readme/busabase-workspace-home.webp" alt="Busabase 工作区首页：待审核队列、最近知识和 Agent 活动" width="100%" />

|  |  |
| :---: | :---: |
| ![Agent 的结构化数据库](../public/assets/readme/busabase-base-table.webp) | ![Agent 的长期知识库](../public/assets/readme/busabase-doc-detail.webp) |
| **数据库**：有类型、有关联、可查询的记录 | **知识库**：带版本历史的长期 Doc |
| ![可复用 Agent Skill](../public/assets/readme/busabase-skill-detail.webp) | ![工作区内的 AirApp](../public/assets/readme/busabase-apps-gallery.webp) |
| **Skills**：可复用指令与配套文件 | **Apps**：直接使用工作区数据的专用界面 |
| ![产品发布白板](../public/assets/readme/busabase-whiteboard.webp) | ![线索处理工作流](../public/assets/readme/busabase-workflow.webp) |
| **白板**：人与 Agent 共享的可视化上下文 | **工作流**：和数据、知识放在一起的流程 |
| ![Agent 提议的字段级差异](../public/assets/readme/busabase-agent-output-preview.webp) | ![记录历史与审计轨迹](../public/assets/readme/busabase-record-detail-audit.webp) |
| **审核**：看清 Agent 到底改了什么 | **溯源**：保留来源、审核人、commit 和历史 |

## 连接你的 Agent

Busabase 本身不绑定模型。你可以连接 Claude Code、Codex、Cursor、Gemini CLI、OpenClaw、Hermes、Buda AI、n8n 或自研 Agent。

<details>
<summary><b>复制本地接入提示词</b></summary>

```text
读取并严格遵循 Busabase Agent Skill；它是唯一的操作规范：
http://localhost:15419/SETUP_SKILL.md

按照其中的 onboarding 连接这个工作区。除非我明确要求，否则不要自己决定合并策略——把改动提交上去，由 Busabase 按我的权限决定它是立即合并还是等待审核。请用中文回复。
```

</details>

**[Claude Code 指南](./claude-code.md)** 介绍本地 Skill 和 Cloud plugin；**[DeepSeek Harness 指南](./deepseek-harness.md)** 介绍 `@busabase/dsh-plugin` 的本地集成；**[Bring Your Own Agent](./bring-your-agent.md)** 介绍通用接入流程。

| 接入方式 | 适合场景 |
| --- | --- |
| **Agent Skill** | 能读取工作区说明的编码 Agent 与本地 CLI |
| **MCP** | 需要类型化工作区工具的 Agent 与 IDE |
| **OpenAPI / CLI** | 应用、脚本、自动化与自研 Agent |
| **Agents 视图（ACP）** | 带工具步骤和权限确认的对话式 Agent session |

在侧边栏打开 **Agent Skills**，即可查看当前实例的接入说明、MCP endpoint 和 OpenAPI specification。

Busabase 的 MCP 服务器同样收录在 [Glama MCP 连接器目录](https://glama.ai/mcp/connectors/com.busabase/busabase)中，附带实时的连接器评分。

## 从工作到可信

Busabase 的做法不是让每一次写入都停下来等人，而是让每一次写入都**有账可查**：

```text
Agent 读取工作区上下文
        ↓
Agent 修改数据、Doc、Skill 或 App——一律以 Change Request 的形式
        ↓
Change Request 带着 diff、说明、作者和影响范围
        ↓
你的权限决定：当场合并，还是进收件箱等人审核
        ↓
无论走哪条路，这次改动都看得见、查得到作者、撤得回来
```

审核是一种能力，不是必经的收费站：把凭据的权限封顶在 `changeRequest`，它就只能提议；某一次调用显式传 `autoMerge: false`，这一次就排队；`busabase-cli install … --require-review` 会把 package 的内容留给你确认。除此之外，有写权限的就直接写——而且照样留下 diff 和历史。

Change Request 不是 Busabase 的品类定义，而是让 Agent Workspace 值得信任的机制。记录更新、Doc 编辑、Skill 文件、schema 变化和 AirApp package 都沿用同一条说明、diff、合并与审计链路。

## 一个完全不同的品类

| 产品类型 | 默认操作者 | Agent 真正工作时缺少什么 |
| --- | --- | --- |
| Airtable、Baserow 等人类数据库 | 人直接编辑行 | Agent 上下文、Skill/App，以及原生提议边界 |
| Notion、Confluence、Obsidian 等知识工具 | 人组织页面 | 跨数据、文件、工具和审核的结构化 Agent 操作 |
| Postgres 等数据库 | 应用读写存储 | 工作区 UI、知识模型、审核闭环和来源追踪 |
| Agent runtime 与聊天工具 | Agent 执行任务并输出结果 | 跨 Agent、跨 session 的长期 system of record |
| **Busabase** | Agent 与人共同建设一个工作区 | 数据库 + 知识库 + Skill + App——产出攒得下来，而不是干完就蒸发 |

## Personal Desktop 与 Cloud

| Personal Desktop / 本地版 | Busabase Cloud |
| --- | --- |
| 免费开源 | 托管的多人工作区 |
| 本地 PGlite 与文件存储 | 托管 Postgres 与对象存储 |
| 无需登录 | 登录、Space、角色与权限 |
| 可离线运行 | 协作、托管 API 与治理能力 |
| 数据保留在本机 | Web 与移动端访问 |

**Cloud Connect** 可以通过认证 tunnel 把本地工作区连接到 [Busabase Cloud](https://busabase.com)。数据和本地 Agent 仍在你的电脑上运行，Cloud 与移动端成为受控的远程入口。

## API 与架构

Busabase 通过 **MCP**、**OpenAPI** 和 `busabase-cli` 暴露整个工作区。机器可读 API 文档位于：

```text
http://localhost:15419/api/v1/doc
```

<div align="center">
  <img src="../public/architecture-diagram.svg" alt="Busabase 架构图" width="100%">
</div>

`apps/busabase` 是本地单工作区 Next.js shell。工作区引擎位于 `packages/busabase-core`，包含节点、记录、文件树、富节点、审核原语、搜索、Agents 和 API contract。[Busabase Cloud](https://busabase.com) 使用同一个核心，并增加多租户身份、权限、托管存储和协作。

## 安全

开源 server 适用于可信本机或私有网络。不要在没有认证和反向代理保护的情况下，把写入 endpoint 直接暴露到公网。远程访问应使用 scoped credential 或 Cloud Connect。

## 参与贡献

```bash
pnpm install
pnpm --filter busabase dev
pnpm --filter busabase typecheck
pnpm --filter busabase lint:err
```

欢迎在 [Issues](https://github.com/busabase/busabase/issues) 和 [Discussions](https://github.com/busabase/busabase/discussions) 提交问题、想法与贡献。

## License

[MIT](../../../LICENSE) © Busabase
