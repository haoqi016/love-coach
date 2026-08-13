# 教恋 · A Little Closer

> 你的专属恋爱沟通教练。

面向恋爱沟通新手的手机端关系复盘 Agent，首先为不擅长表达的工科男生设计，也适合每个想把话说清楚的人。用户粘贴聊天文字，或上传 1–3 张截图并校对提取结果；系统区分已有线索与不确定项，再给出尊重边界、可以自行改写的下一步表达。

## 当前可用能力

- 五步手机流程：隐私提示 → 上传/粘贴 → 文字校对 → 选择关系阶段和目标 → 查看建议。
- 首页固定品牌标题使用随站点自托管的开源 LXGW WenKai Webfont；正文、表单和分析结果继续使用清晰的系统无衬线字体。运行时不请求第三方字体 CDN，字体与 Webfont 包许可证保存在 `apps/web/public/licenses/`。
- 可以粘贴完整聊天记录或只保留相关片段；不设句数规则，单次文字输入的技术上限为 60,000 字符。
- 共同话题、未完线索、互动节奏、不确定项和建议聊天深度。
- 结果中的概述、互动判断、共同话题、未完线索、话题桥和消息选项均紧邻显示依据：聊天事实引用可核对的短原文，行动项明确标记为“建议，不是聊天事实”。
- 1–3 个可编辑、可复制的消息选项；不自动发送，不输出“好感概率”。
- JPG/PNG 截图可点击选择或从桌面、文件资源管理器及支持文件拖出的应用直接拖入；图片仅在内存中处理，未配置视觉模型时安全回退到手工录入。
- 截图 OCR 为每条消息标记“我 / 对方 / 无法判断”；读取前必须确认截图来自用户自己的聊天界面，结果仍需逐句校对。
- REST API 与 MCP 唯一工具 `guide_next_conversation` 共用同一 Agent Core 和 Zod Schema。
- 文字关系分析支持“自动选择”或服务端白名单中的指定模型；显式选择失败时只回退本地整理，不会偷偷换用另一个远程模型。截图 OCR 仍自动选择视觉模型。
- 结果页明确显示 Eazo AI、本地回退或安全保护来源；远程成功时显示非敏感模型名与 Prompt 版本。
- 可安装 PWA；Service Worker 只缓存静态 GET 资源，不缓存 `/api/*`、`/mcp`、聊天内容或模型结果。
- 对操控、骚扰、跟踪、绕过拒绝、性胁迫、自伤和暴力内容执行确定性安全分流。
- Prompt v4 按“可观察事实 → 原文证据 → 不确定性 → 沟通策略 → 低压力下一步”组织结果；6 个关系阶段、7 个聊天目标和 5 种用户语气会组合为服务端可信策略，而不会改变聊天事实或风险判断。服务端会拒绝不属于输入聊天的引用和超出当前关系阶段的建议深度，不做诊断、好感打分或操控建议。
- 可选的结果页实时语音复盘：用户先选定一条已有草稿，再在 5 分钟内围绕它与语音教练讨论、插话、静音或打断。每轮完整转写先经过确定性安全检查；点击“结束并用本次转写生成建议”后，Prompt v4 才把已完成且通过检查的用户转写整理成新版建议。新结果可以再次选稿并继续下一轮。

## 仓库结构

```text
apps/web                 React/Vite 手机网站与 PWA
apps/server              REST、截图入口、MCP、生产静态托管
packages/contracts       共享 Zod 输入输出契约
packages/agent-core      Agent 流水线、安全规则与模型适配接口
docs                     架构、安全和评测说明
```

## 改动记录

- [`CHANGELOG.md`](./CHANGELOG.md)：按日期记录用户可感知的新增、调整和修复。
- [`docs/iterations/`](./docs/iterations/)：记录每轮优化的目标、基线、技术决策、验证证据、Eazo Credits 和回滚边界。
- `task_plan.md`：只跟踪当前执行阶段；完成后的稳定结论转入迭代记录。

推荐以 Git 提交作为精确代码历史，并让每个提交对应一条迭代记录或 `CHANGELOG` 条目。禁止把密钥、真实聊天或可识别截图写入任何历史文件。

## 本地运行

要求 Node.js 24 与 pnpm 11.16.0。

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

- 手机网页：`http://localhost:5173`
- 健康检查：`http://localhost:8787/health`
- REST：`POST http://localhost:8787/api/guidance`
- 可用分析模型：`GET http://localhost:8787/api/models`
- 截图提取：`POST http://localhost:8787/api/extract`，multipart 字段为 `screenshots`
- 语音能力：`GET http://localhost:8787/api/voice/capabilities`；默认关闭，未配置时结果页不会显示语音入口
- MCP：`http://localhost:8787/mcp`

Vite 会把 `/api/*` 代理到 `8787`。开发模式同时运行 Web 与 Server。

## 生产运行

```powershell
pnpm build
pnpm start
```

构建完成后，Server 会在同一端口提供 `apps/web/dist`、REST 和 MCP。也可以使用根目录 `Dockerfile` 构建单容器镜像。

## 模型配置

比赛版本支持两条服务端模型通道。活动期间的默认顺序是：OpenAI-compatible → Eazo App AI → 本地确定性/手工回退。REST 与 MCP 共用同一个有序 Provider 链；截图识别按 OpenAI-compatible vision → Eazo vision → 手工录入降级。

### 活动 OpenAI-compatible Provider

主办方临时网关使用 OpenAI-compatible Chat Completions。在 Railway Variables 或本机 `.env` 中配置：

```text
MODEL_API_BASE_URL=https://api.openai-next.com/v1
MODEL_API_KEY=...
TEXT_MODEL_NAME=gpt-4.1-mini-2025-04-14
TEXT_MODEL_OPTIONS_JSON=[{"id":"event-gpt41-mini","label":"GPT-4.1 mini","description":"比赛主模型，速度与稳定性优先","provider":"openai-compatible","model":"gpt-4.1-mini-2025-04-14"},{"id":"eazo-deepseek-v32","label":"DeepSeek V3.2","description":"Eazo 备用模型","provider":"eazo","model":"deepseek.v3.2"}]
VISION_MODEL_NAME=qwen3-vl-plus
MODEL_MAX_REQUESTS_PER_MINUTE=60
MODEL_MAX_CONCURRENT_REQUESTS=4
MODEL_MAX_REQUESTS_PER_DAY=60
MODEL_CHAIN_TIMEOUT_MS=60000
```

`MODEL_API_KEY` 只放服务端。浏览器只能取得经过清洗的模型别名、显示名称和说明，并提交服务端白名单中的别名；它不会收到 Key、API 地址、真实路由配置，也不能把任意字符串当作上游模型。网关地址没有写死，活动 Key 失效后可以清空这些变量，系统会继续使用 Eazo 与本地回退。

`TEXT_MODEL_OPTIONS_JSON` 最多配置 8 个文字模型选项，并且只能列出已经配置了对应服务端凭据的 Provider。`auto` 是系统保留值，不写入 JSON；未配置该变量时，服务会从现有 `TEXT_MODEL_NAME` 与 Eazo 文字模型自动生成可选项，旧部署不需要立刻增加变量。显式选择某个模型后，只尝试该模型并在失败时进入本地基础整理；选择“自动”才会运行完整的 OpenAI-compatible → Eazo → 本地回退链。所有模式仍共用一次请求 60 秒的总预算。

生产 Prompt v3 的受控测试中，`deepseek-v3.2` 在 30 秒预算内未完成；固定版本 `gpt-4.1-mini-2025-04-14` 通过了同一严格 JSON/evidence 路径。因此上面的比赛部署示例使用后者，Eazo 的 `deepseek.v3.2` 仍保留为第二远程 Provider。

活动页面在 2026-08-09 检查时显示 Key 有效期至 `2026-08-11 00:00`，但未标明时区。该网关只能作为比赛期依赖，不应作为长期生产配置。其公开指南未说明聊天或截图保存时长，因此真实测试必须先去除姓名、头像、账号、电话、位置等标识。

在本地检查全部通过后，可用一条内置脱敏样例执行一次无本地回退的文字连通测试：

```powershell
pnpm test:model
```

该命令消耗 1 次文字模型调用，只输出非敏感模型名、耗时、风险等级和候选消息数量，不输出聊天内容或 Key。

### Eazo App AI fallback

Eazo 文字指导默认 `deepseek.v3.2`，截图识别默认 `qwen.qwen3-vl-235b-a22b-instruct`。在 Railway Variables 或本机 `.env` 中配置：

```text
EAZO_APP_AI_API_BASE=https://eazo.ai/creator
EAZO_APP_ID=...
EAZO_PRIVATE_KEY=...
EAZO_AI_MODELS_JSON={"text":"deepseek.v3.2","vision":"qwen.qwen3-vl-235b-a22b-instruct"}
EAZO_MAX_REQUESTS_PER_MINUTE=60
EAZO_MAX_CONCURRENT_REQUESTS=4
EAZO_MAX_MODEL_REQUESTS_PER_DAY=60
```

`EAZO_APP_ID` 与 `EAZO_PRIVATE_KEY` 必须同时存在且只放在服务端。浏览器不会收到私钥或 `model_key`；没有完整 Eazo 配置时，应用仍能使用其他已配置 Provider 与本地回退。

`EAZO_MAX_*` 继续兼容旧部署；配置 `MODEL_MAX_*` 后，通用限制优先并同时覆盖 OpenAI-compatible 与 Eazo 的远程尝试。未完整配置任何远程通道时，服务不会把文本或截图发送给第三方。

`MODEL_CHAIN_TIMEOUT_MS` 是一次请求跨所有远程 Provider 的总时间预算，代码默认与最大值均为 60 秒。它不是“每个 Provider 各 60 秒”：主模型如果快速失败，备用模型只能使用剩余时间；总计到 60 秒后停止远程链并返回本地/手工回退。浏览器等待 70 秒，只用于容纳上传和接收服务器在截止点产生的响应，不会把模型处理延长到 70 秒。外部 MCP 评测器若自行设置更短的客户端超时，应用无法替它延长。

模型 Credits 仅用于受控联调和最终连通验证；本地构建、单元测试和静态检查不会消耗 Credits。公网部署默认每分钟最多接受 60 个 AI 入口请求、同时处理 4 个推理请求、每个进程 24 小时最多尝试 60 次真实远程模型请求；达到日上限后文字自动回退本地、截图回退手工录入。一次请求若从主 Provider 降级到 Eazo，会计为两次远程尝试。该计数器适合比赛用的单实例部署，不是跨实例计费账本。

Railway 会自动提供 `RAILWAY_PUBLIC_DOMAIN`，服务会把它加入 Host 白名单；自定义域名仍需写入 `MCP_ALLOWED_HOSTS`。截图单张上限由 `MAX_UPLOAD_MB` 控制，单次合计上限由 `MAX_TOTAL_UPLOAD_MB` 控制。

首次真实连通测试使用一条内置的脱敏样例，并明确关闭本地回退：

```powershell
pnpm test:eazo
```

该命令会消耗 1 次文字模型调用，只输出模型名、耗时、风险等级和候选消息数量，不输出聊天内容或密钥。仅在本地检查全部通过且服务端凭据已配置后运行。

### OpenAI Realtime 语音复盘（可选）

语音使用官方 OpenAI Realtime WebRTC，不复用比赛文字网关的 Chat Completions Key。Railway 只用标准 API Key 签发短期浏览器临时密钥；原始音频通过 WebRTC 直接发往 OpenAI，不经过本应用服务器。所选草稿、当前分析摘要、关系阶段、目标和语气等压缩文本上下文也会发送给 OpenAI Realtime。配置：

```text
VOICE_ENABLED=false
OPENAI_REALTIME_API_BASE=https://api.openai.com/v1
OPENAI_REALTIME_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
VOICE_SESSION_MAX_SECONDS=300
VOICE_MAX_ACTIVE_LEASES_PER_INSTANCE=2
VOICE_MAX_SESSION_STARTS_PER_DAY=30
VOICE_CONTEXT_SIGNING_SECRET=
```

启用前必须同时设置 `OPENAI_REALTIME_API_KEY` 和至少 32 字符的随机 `VOICE_CONTEXT_SIGNING_SECRET`，并把真实值直接填入 Railway Variables，不要粘贴到聊天、源码、`.env.example` 或 Git 历史。`OPENAI_REALTIME_API_BASE` 只接受官方 `https://api.openai.com/v1`，避免把标准 Key 发往非官方网关。页面会先取得麦克风权限并预加载 SDK，再申请一枚仅用于立即建连、约 10 秒到期的 `clientSecret`；浏览器不会收到标准 API Key。

这是“分析后的建议打磨层”，不是第二套恋爱分析器。开始语音前必须从当前结果中选定一条草稿；Realtime 模型只围绕该草稿澄清用户想保留、删除或调整的内容。自动回复被关闭，每个完成转写都要先调用同源安全端点。手动结束或五分钟到时后，只有已完成且通过检查的用户转写会进入现有 Prompt v4 文字链；这些转写会连同原请求发送给当前配置的分析模型服务，自动模式可能按 OpenAI-compatible → Eazo 的 Provider 链尝试。生成成功后页面会同时采用新版建议、请求上下文和短期签名 Token，因此用户可以继续选稿进入下一轮。远程生成失败时保留上一版结果，不会用未消费语音内容的本地模板伪装成更新成功。MCP 工具保持不变。

当前比赛版使用浏览器 5 分钟计时和单实例内存租约限制会话；Railway 必须固定为 **1 个 replica**。它们不是跨实例硬计费系统，也不能从 Railway 强制切断已经建立的 WebRTC；生产成本的硬上限必须同时配置在 OpenAI 项目侧。转写门控与输出 guardrail 也位于可修改的浏览器客户端，只是比赛版的纵深保护，不是不可绕过的服务端安全边界；公开规模使用前应增加 Realtime sideband 服务端控制，或改为服务端 STT → 安全文字链 → TTS。默认不保存原始音频或完整转写，关闭语音面板会停止麦克风、关闭连接并清空会话内存。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

测试覆盖契约、正常与信息不足对话、安全拦截、截图限制、结构化错误、官方 MCP 客户端发现和调用工具，以及语音选稿、临时密钥、租约、转写安全门、单次结束生成、迟到事件、失败保留和重复轮次。语音安全 release gate 另含 48 条合成转写，覆盖所有现有风险类别、ASR 断词、第三方引用和良性相似表达，不访问远程模型。

固定评测使用 17 个合成样例检查 Prompt v4 的输出契约、安全分流、策略差异、语气、重复性和原文证据，不访问网络或消耗模型额度：

```powershell
pnpm eval:fixed
```

当前本地基线为 17/17 cases、359/359 checks、0 次远程调用。报告写入 `evals/reports/latest.json` 和 `evals/reports/latest.md`。

生产三路径 smoke 默认只是 dry run，不会访问公网：

```powershell
pnpm smoke:production
```

确认使用脱敏合成截图后，才执行 Railway 的文字、截图、MCP 三条路径：

```powershell
pnpm eval:screenshot
pnpm smoke:production -- --base-url=https://web-production-fb777.up.railway.app --screenshot=tmp/evals/synthetic-chat.png --confirm-remote=RUN
```

实际 smoke 严格按 `text → screenshot → mcp` 执行，最多发出 3 个业务推理请求，不自动重试；任一路径首次失败就立即停止。远程 Provider 自身若发生链式回退，实际的上游模型尝试数可能高于业务请求数，因此执行前仍需确认额度、变量和脱敏材料。

## 产品边界

- 首版仅面向 18 岁以上用户。
- 这是沟通整理工具，不是心理治疗、诊断、恋爱成功保证或代聊服务。
- 默认不保存聊天原文、截图或第三方身份信息；用户应先遮挡姓名、头像、账号、电话和地址。
- 实时语音仅面向确认已满 18 周岁的用户；本应用不持久化原始音频或完整转写。原始音频、所选草稿、当前分析摘要和关系设置由 OpenAI Realtime 处理；结束后，已通过检查的文字转写会交给当前配置的分析模型服务，自动模式可能按 Provider 链尝试。
- 动态模式不再用第三方处理勾选框阻断截图读取或文字分析；用户确认截图视角后即可继续。静态模式仍明确说明只使用浏览器内的基础规则。
- 若文本涉及立即人身危险，停止普通关系推进建议，并优先提示联系可信任的人和当地紧急服务。
