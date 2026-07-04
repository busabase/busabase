<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../public/icon-dark.svg" />
  <img src="../public/icon.svg" alt="Busabase" width="96" height="96" />
</picture>

<h1>Busabase</h1>

<p><b>面向 AI 生成内容、业务数据、数据集与多模态知识的本地优先审核数据库。</b><br/>
AI 可以源源不断地生成数据 —— Busabase 让你在数据成为可信记录前先 <b>审核、批准、合并</b>。</p>

<p>
<a href="../README.md">English</a> &nbsp;·&nbsp; <b>中文</b> &nbsp;·&nbsp; <a href="./README_ja.md">日本語</a> &nbsp;·&nbsp; <a href="./README_ko.md">한국어</a>
</p>

<p>
<a href="https://www.npmjs.com/package/busabase"><img src="https://img.shields.io/npm/v/busabase?logo=npm&label=busabase&color=3fb950" alt="npm busabase" /></a>
<a href="https://www.npmjs.com/package/busabase-cli"><img src="https://img.shields.io/npm/v/busabase-cli?logo=npm&label=busabase-cli&color=3fb950" alt="npm busabase-cli" /></a>
<a href="https://hub.docker.com/r/busabase/busabase"><img src="https://img.shields.io/docker/image-size/busabase/busabase/latest?logo=docker&label=docker" alt="Docker image" /></a>
<a href="https://busabase.com/download"><img src="https://img.shields.io/badge/Desktop-Download-1f6feb?logo=tauri&logoColor=white" alt="Download Busabase Desktop" /></a>
<a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License MIT" /></a>
<a href="https://github.com/busabase/busabase/stargazers"><img src="https://img.shields.io/github/stars/busabase/busabase?style=social" alt="GitHub stars" /></a>
</p>

<br/>

<img src="../public/assets/readme/busabase-hero-zh-CN.webp" alt="Busabase" width="100%" />

</div>

Busabase 是一款开源应用，专为解决一个简单的问题而生：

**AI 可以源源不断地生成内容和数据，但仍然需要有人来决定哪些内容值得信任。**

Busabase 为这一审批流程提供了专属的承载空间。它是一款集私有 CMS、知识库、项目数据库与结构化可信数据源于一体的工具，内置变更请求、操作记录、评论、审计追踪，并提供简洁的 API，供应用程序和 AI 智能体调用。

![Busabase 工作流程：提交 → 审核 → 批准 → 合并 → 可信的数据库与知识库](../public/assets/readme/how-it-works.webp)

**本地优先。审核优先。智能体就绪。**

## 快速开始

在本地运行 Busabase：

```bash
pnpm install
cp apps/busabase/.env.example apps/busabase/.env
pnpm --filter busabase dev
```

打开控制台：

```txt
http://localhost:15419/dashboard/inbox
```

Busabase 在开发服务器启动前会执行本地启动检查。如果缺少依赖项、`PG_DATABASE_URL` 或 `STORAGE_URL`，命令将失败并输出配置提示，而不是打开一个空白的控制台。默认的 `.env.example` 使用 `.data/busabase` 下的 PGlite，以及 `.data/busabase-storage` 下的本地文件存储。

Busabase 在首次请求时会自动填充示例 Base、记录和变更请求，让你可以立即查看审核工作流。

启动后你将获得：

- 用于审核变更请求的收件箱
- 示例 Base 和记录
- 记录级别的历史记录与审计追踪
- `.data/busabase` 下的本地 PGlite 持久化存储
- 面向应用、工作流和 AI 智能体的 REST API 端点

Docker：

```bash
docker build -f apps/busabase/Dockerfile -t busabase:local .
docker run --rm -p 15419:15419 busabase:local
```

打开容器：

```txt
http://localhost:15419/dashboard/inbox
```

## 截图

|  |  |
| :---: | :---: |
| ![收件箱审核列表](../public/assets/readme/busabase-inbox-review.webp) | ![智能体提案差异对比](../public/assets/readme/busabase-agent-output-preview.webp) |
| 收件箱，展示待处理变更请求、审核状态和批准操作 | 合并前的智能体提案变更，包含字段差异和审核操作 |
| ![记录详情溯源](../public/assets/readme/busabase-record-detail-audit.webp) | ![Base 表格](../public/assets/readme/busabase-base-table.webp) |
| 记录详情页，展示字段、评论、审核历史和溯源信息 | Base 表格，展示结构化记录和富字段 |
| ![Base 记录表格](../public/assets/readme/busabase-base-records.webp) | ![种子数据图谱视图](../public/assets/readme/busabase-graph-view.webp) |
| Base 内部的记录——类型化字段、富值和一目了然的批准状态 | 图谱视图，展示跨 Base 种子记录之间的关系 |

## 为什么要做这个

大多数数据库擅长存储数据。大多数 CMS 工具擅长发布内容。大多数代码平台擅长审查文件。

Busabase 面向的是重度使用 AI 的团队如今所需的中间层：

| 需求 | Busabase 提供的能力 |
| --- | --- |
| AI 起草博客文章 | 在其成为已发布 CMS 记录之前先进行审核 |
| 人工清洗 QA 数据 | 在用于训练或评估之前批准高质量样本 |
| 智能体为视频打标签 | 在多模态元数据进入数据集之前进行核查 |
| 智能体更新项目或 ERP 数据 | 由人工审核员在系统记录变更之前批准修改 |
| 本地 AI 工具需要记忆 | 对外暴露一个经过审计的私有 API，供智能体访问已批准的知识 |
| 数据变更应触发后续工作 | 在批准合并后触发 Webhook、自动化流程或外部智能体 |
| 有人修改了记录 | 追踪谁提出了提案、谁审核、谁合并、谁查看、谁删除 |

它默认以批准为先，在设计上对智能体友好，同时依然轻量到足以在本地运行。

## 概念

核心概念：

| 概念 | 含义 |
| --- | --- |
| Base | 类似表格的记录集合 |
| 字段 | Base 上的类型化属性 |
| 记录 | 已批准的一行数据 |
| 变更请求 | 对数据进行修改的可审核提案 |
| 操作 | 变更请求中的创建、更新、删除或变体动作 |
| 提交 | 操作背后的不可变数据快照 |
| 评论 | 附加在记录、变更请求、操作或提交上的讨论 |
| 审计事件 | 重要读取、写入、审核、合并和删除操作的追踪记录 |

## 用例

Agent 能写入的任何 Base —— 都先经过审核。人们用 Busabase 构建的一些场景：

| 用例 | 你审核的内容 |
| --- | --- |
| **面向 Next.js 的博客 CMS** | 将 Busabase 用作博客或编辑工作流的本地 CMS。 |
| **SEO 落地页** | 使用 Busabase 管理和审核 AI 生成的 HTML 落地页，在上线前进行把关。 |
| **配置管理** | 使用 Busabase 将服务配置以 YAML 和 JSON 格式进行存储和版本管理。AI 智能体以变更请求的形式提出配 |
| **财务与发票审核** | 将 Busabase 用于需要自动化辅助、但仍然需要人工把关的财务工作流。 |
| **数据治理与 CRM 数据清洗** | 将 Busabase 用作保持业务数据整洁的审核队列。 |
| **合规与审计检查清单** | 将 Busabase 用于需要留存证据的定期核查。 |
| **高质量 QA 与训练数据集** | 使用 Busabase 构建用于模型训练、评估、RAG 和基准测试的数据集。 |
| **多模态内容审核** | Busabase 的设计不止于文本。 |
| **市场情报与研究监控** | 将 Busabase 用作经过人工审核的研究信息流。 |
| **内容工厂流水线** | 使用 Busabase 协调从创意到发布资产的内容生产全流程。 |
| **数据集标注流水线** | 使用 Busabase 将智能体优先标注与人工审核相结合。 |
| **基于审批的项目管理与 ERP** | 将 Busabase 用作操作数据的轻量级审批层。 |
| **权威数据源** | 将 Busabase 用作**系统记录**——无论有多少人和 AI 智能体向其写入，这里始终保存每条记录的权威、已批准版 |
| **本地个人知识库** | 在你自己的机器上运行 Busabase，作为你和你的 AI 工具的私有数据库。 |
| **可验证的例行工作** | 将 Busabase 用于必须被完成、审核和记录的日常或周期性工作。 |
| **字段类型实验室** | 使用 Busabase 在一个本地场景中验证所有支持的字段类型和审核操作。 |

**[→ 查看全部 16 个用例（含截图）](./use-cases_zh-CN.md)**

## 自动化与 ACP 智能体

Busabase 可以成为数据工作流的事件源。

在审核过程中，人工可以要求 ACP 兼容的智能体在合并之前改进变更请求：

- 清洗字段
- 补充缺失元数据
- 规范化分类
- 重写草稿
- 生成摘要或标签
- 检查政策、质量或一致性

合并后，已批准的数据可以触发下游自动化：

- 发送 Webhook
- 更新外部系统
- 通知审核员或频道
- 刷新 Next.js 站点
- 启动 ETL 或数据集导出
- 调用外部 ACP 智能体继续工作流

这使 Busabase 不仅仅是一个存储数据的地方，更成为人工、应用程序和智能体之间受控交接的节点。

## 本地智能体操作你的知识库

Busabase 的设计初衷是被已经在你自己电脑上运行的智能体所驱动。

由于 API 是本地且可信的，你可以将编码和自动化智能体——**OpenClaw、Codex、Claude Code、Hermes** 等类似的本地技能——直接指向你的 Busabase 实例。它们可以读取已批准的知识，对其运行技能，并以变更请求的形式将修改提案回传。

本地智能体可以用 Busabase 做什么：

- 以已批准的私有知识作为基础上下文进行读取
- 运行查询或汇总 Base 的本地技能
- 以可审核的变更请求形式提出新记录或编辑
- 在没有不受控写入权限的情况下丰富、清洗或标注数据
- 在任何内容成为可信数据之前等待人工批准

```txt
本地智能体读取已批准知识 ->
提出变更请求 ->
你在自己的机器上审核 ->
批准 -> 合并到你的本地可信数据源
```

> 如果 OpenClaw 是本地计算机上**智能体**的革命，那么 BusaBase 就是本地计算机上**数据库和知识库**的革命。

## Busabase 关注什么

Busabase 不只是在问"这一行的最新值是什么？"

它还会问：

- 谁提出了这条数据？
- 为什么要修改？
- 哪些字段发生了变化？
- 这是创建、更新、删除还是变体操作？
- AI 智能体在被接受之前产生了什么？
- 谁审核了智能体的输出？
- 人工是否要求智能体修改？
- 该提案是被合并还是被拒绝？
- 合并后运行了哪些自动化？
- 我们能在事后追溯这个决定吗？

这使 Busabase 在 AI 智能体工作中尤为有用。智能体可以产生草稿、标签、摘要、对账结果或操作更新，而 Busabase 在这些输出成为可信数据之前，为人工提供一个预览层。

## Busabase 的对比

Busabase 与一些熟悉的工具有所重叠，但它为一个不同的目标而优化：**让 AI 智能体写入数据，并由人在数据成为可信数据之前进行审批。**

| 工具 | 擅长领域 | Busabase 额外提供的能力 |
| --- | --- | --- |
| [Airtable](https://www.airtable.com/) | 面向人类团队的灵活云端表格 | 本地优先的数据所有权 + 审批门：智能体提案、人工审批，并提供差异预览、历史记录和审计追踪 |
| [APITable](https://github.com/apitable/apitable) | 开源、API 优先的 Airtable 替代品 | API 优先**之外**，还在提案与可信记录之间增加了一道审核层 |
| [NocoDB](https://nocodb.com/) | 在你的 SQL 数据库之上提供电子表格界面 | 每一次写入都是可审核的变更请求，而不是直接的行编辑 |
| [Baserow](https://baserow.io/) | 可自托管的无代码数据库 | 变更请求、审计追踪和智能体钩子 |
| [Notion](https://www.notion.com/) | 云端文档、数据库和团队知识 | 一个纯粹、本地、结构化的知识库，内置审核流程——无需厂商云 |
| [Confluence](https://www.atlassian.com/software/confluence) / [Lark](https://www.larksuite.com/en_sg/) | 厂商托管的团队 wiki | 首先运行在你自己的机器上；数据无需离开本地 |
| [Obsidian](https://obsidian.md/) | 面向个人的本地优先 Markdown 笔记 | 同样是本地的——但它是面向智能体的结构化数据库：变更请求、审批和审计，而非自由格式的笔记 |
| [PostgreSQL](https://www.postgresql.org/) | 可靠的存储与查询 | 围绕每次变更的人类可读变更请求、审核、评论和自动化 |
| [GitHub Pull Requests](https://docs.github.com/en/pull-requests) | 基于文件差异的代码审查 | 面向内容、数据集、CRM 行、任务和多模态数据的基于记录的审核 |

这些工具大多假设写入者是可信的人工（或你自己编写的脚本）。Busabase 则假设写入者通常是 **AI 智能体**——并且并非每次智能体写入都应自动被信任。因此，它增加了智能体驱动型数据库所需的能力：

- **提案层**——智能体提交变更请求，而不是直接编辑行数据。
- **合并前预览**——逐字段查看智能体产出的确切内容。
- **修改循环**——在提案被接受之前要求智能体修正。
- **审计追踪**——每次读取、写入、审核、合并和删除都可追溯。
- **本地可信 API**——专为你自己机器上的智能体而生，而不仅仅是人工电子表格用户。

```txt
Airtable / APITable：供人编辑的数据库。
Busabase：供智能体提案、供人批准的数据库。
```

**本地优先，而非云优先。** 默认情况下，你的数据保存在你自己的机器或私有网络上。需要远程或智能体访问？通过隧道暴露选定端点，而不是将所有内容复制到中央云数据库。可自托管、免费且开源。

## 功能特性

- 本地优先的开源应用
- 内置审核工作流
- 支持多操作的变更请求
- 创建、更新、删除和变体操作
- 记录变更的提交历史
- 记录和审核对象上的评论
- 读写操作的审计事件
- Markdown、HTML、链接、文件、关联关系字段及富字段类型
- 支持搜索的索引字段值
- 面向应用、工作流和 AI 智能体的 REST API
- 针对智能体提案的人工介入协作
- 合并前的 AI 智能体输出预览
- 已批准操作记录的单一可信数据源
- 已批准数据变更后的自动化触发
- 审核期间和合并后的 ACP 智能体钩子
- PGlite 本地持久化
- Docker 友好的部署方式

## API 接口

Busabase 为控制台客户端、应用程序和 AI 智能体暴露了一套简洁的本地 REST API。

典型资源包括：

- Base 和节点
- 记录
- 搜索
- 评论
- 变更请求
- 审核
- 合并操作
- 活动和审计事件

该 API 在开源版本中面向可信的本地或私有网络使用。

### 智能体提案示例

```bash
# 1. 找到 Blog Posts Base。
BLOG_BASE_ID=$(curl -s http://localhost:15419/api/v1/bases \
  | jq -r '.[] | select(.slug == "blog") | .id')

# 2. 让智能体提出一条新记录。
CHANGE_REQUEST_ID=$(curl -s -X POST \
  "http://localhost:15419/api/v1/bases/$BLOG_BASE_ID/change-requests" \
  -H 'content-type: application/json' \
  -d '{
    "fields": {
      "title": "Agent market note",
      "body": "Drafted by an agent, waiting for human review.",
      "channel": "blog"
    },
    "message": "Agent proposed a market note",
    "submittedBy": "local-agent"
  }' | jq -r '.id')

# 3. 在控制台中审核它。
echo "Review: http://localhost:15419/dashboard/inbox/$CHANGE_REQUEST_ID"

# 4. 人工批准后可选的自动化操作。
curl -s -X POST "http://localhost:15419/api/v1/change-requests/$CHANGE_REQUEST_ID/merge" \
  | jq '.record.id, .record.headCommit.fields.title'
curl -s "http://localhost:15419/api/v1/records?baseId=$BLOG_BASE_ID" \
  | jq '.[].headCommit.fields.title'
```

如需机器可读的端点文档，请打开：

```txt
http://localhost:15419/api/v1/doc
```

## 何时使用 Busabase

在以下情况下使用 Busabase：

- AI 生成内容，但由人工决定哪些内容值得信任。
- AI 智能体提出更新，但人工保有最终决定权。
- 你需要一个基于审批的项目管理、CRM、ERP 或运营数据库。
- 你有必须被完成、审核和记录的例行操作工作。
- 你的团队需要具备审核历史的高质量数据集。
- 你需要人工在 AI 智能体输出成为可信记录之前进行预览。
- 你需要一个将内容视为结构化记录的 CMS。
- 你需要一个 AI 可以安全读取的私有本地数据库。
- 你希望数据分布在各人的本地工作空间，并在需要时有选择地共享。
- 你需要已批准业务数据的单一可信数据源。
- 你希望已批准的数据变更触发 Webhook、工作流或外部智能体。
- 你希望智能体在人工批准之前帮助完善变更请求。
- 你的数据是多模态的，不仅仅是纯文本行。
- 你关心谁查看、修改、审核、合并或删除了数据。

不要将 Busabase 用作你的主要代码审查系统。代码审查请使用 GitHub pull request。

## 路线图

Busabase 从本地优先起步，然后向外扩展。

### 本地 Busabase

开源版本在本地运行，数据存储在你的掌控之下。

### Busabase Cloud

未来的云托管版本将提供托管协作、云端存储、团队访问控制，以及对希望使用云端运营的团队更便捷的部署方式。

### Busabase Tunnel

未来的隧道模式可以将本地 Busabase 实例暴露到公共互联网或受控网络，而无需将所有数据迁移到中央云数据库。

## 开源形态

本地开源版本有意保持精简：

- 默认无需登录
- 单个本地工作空间
- 应用本地 Drizzle schema
- `.data/busabase` 下的 PGlite 持久化
- `/dashboard/inbox` 控制台
- 面向本地应用和可信智能体的 REST API

## 安全说明

Busabase 专为可信的本地或私有网络部署而设计。

在没有反向代理、令牌层或其他访问控制层的情况下，请勿将写入端点暴露到公共互联网。
