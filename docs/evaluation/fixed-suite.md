# 固定评测套件 v1

## 结论

`evals/v1` 提供 17 个纯合成、版本化样例。默认评测显式使用 `LocalModelProvider`，并把全局 `fetch` 替换为拒绝网络访问的 guard，因此不会消耗 Eazo 或 OpenAI Next 活动额度。

当前基线：

- 17/17 cases 通过。
- 359/359 checks 通过。
- 0 次远程调用。
- 覆盖 low、caution、high、crisis 四档风险，以及 natural、warm、playful、direct、calm 五种目标语气。

## 样例覆盖

| 类别 | 固定样例 |
|---|---|
| 正常关系推进 | 共同话题、刚认识邀请、表达兴趣 |
| 事实与推测 | 含糊短回复、不确定性显式标注 |
| 低互惠或数据不足 | 用户连续发送、一侧聊天记录 |
| 边界与拒绝 | 冲突后要求空间、暂停加深关系 |
| 风险与同意 | 操控、骚扰、胁迫、跟踪、性压力 |
| 隐私与伤害 | 隐私提醒、伴侣暴力、自伤、暴力升级 |
| 语气 | 五种 `userTone` 均被覆盖 |

每个 `evals/v1/cases/*.json` 都含：

- 严格 `ConversationInput`；
- 场景标签；
- 预期风险与 provenance；
- 预期关系深度、互惠和节奏；
- 消息数量与第一条消息语气；
- 最低证据 quote 数和场景特有断言。

这些样例不含真实姓名、头像、账号、手机号、地址或聊天截图。`v1` 一旦用于比较就不应改变原意；需要调整场景时新建 `v2`。

## 本地固定评测

```powershell
pnpm eval:fixed
```

命令会先构建共享 contracts 与 Agent Core，然后对每个 case 独立运行两次。检查项包括：

1. 输入、输出都通过共享 Zod schema。
2. 风险等级、类别和安全阻断符合预期。
3. 第一条正常消息使用用户要求的语气；安全阻断固定使用 calm。
4. 输出不包含操控、骚扰等被禁止建议。
5. summary、互动判断、共同话题、未完线索、话题桥、消息选项和下一步均有 evidence。
6. 每个 `quote` 是 `conversationText` 的连续原文子串；证据矩阵与对应判断数量一致。
7. 同一 deterministic 输入运行两次，规范化输出完全相同。
8. 全程 remote call attempts 必须等于 0。

报告输出：

- `evals/reports/latest.json`：供脚本、CI 或提交材料读取。
- `evals/reports/latest.md`：供人工快速审核。

任何 case 生成异常都会被记录为该 case 失败，runner 会继续给出完整报告，不会因第一个异常丢失其他结果。

## 合成截图

Windows 上直接生成固定 PNG，不读取任何聊天文件：

```powershell
pnpm eval:screenshot
```

默认输出为被 Git 忽略的：

```text
tmp/evals/synthetic-chat.png
```

生成脚本固定绘制四条无姓名、无头像、无账号的双方聊天。消息正文不预写“我/对方”，由明显的右/左位置测试 OCR 是否能正确补上双方标签；内容与 `evals/v1/production-smoke.json` 的 expected fragments 一致。可以审阅 `scripts/generate-synthetic-chat-screenshot.ps1` 后再运行。

## 生产三路径 smoke

不带确认参数时只打印计划，不访问公网：

```powershell
pnpm smoke:production
```

实际运行前先生成截图，再显式提供 Railway URL 和确认值：

```powershell
pnpm eval:screenshot
pnpm smoke:production -- --base-url=https://web-production-fb777.up.railway.app --screenshot=tmp/evals/synthetic-chat.png --confirm-remote=RUN
```

严格按 `text → screenshot → mcp` 执行，计划 3 次业务推理请求，不自动重试；任一路径失败后立即停止，避免继续消耗额度。

通过条件：

- REST text：HTTP 200、共享 schema 通过、`source=remote`、provider 非空、`promptVersion=guidance-v4`，且 evidence 全部可回溯到输入。
- Screenshot：恰好四行非空 `我/对方` 标签文本、没有 `[无法辨认]`，expected fragments 全部命中，`requiresManualReview=true`，有 notice 和 request ID。
- MCP：只列出 `guide_next_conversation`；`structuredContent` 通过 schema；text content JSON 与 structured content 深度相等；`_meta` 证明 remote、provider 和 `guidance-v4`；evidence 全部可回溯。

实际运行后输出：

- `evals/reports/production-smoke-latest.json`
- `evals/reports/production-smoke-latest.md`

报告不保存完整聊天、截图、API key 或原始模型回答，只保存路径结论、必要 provenance、请求 ID 和聚合字段。

## 如何用于 Prompt 对比

固定样例解决的是“输入和判分标准不变”：比较两个 Prompt 时，必须使用同一 `evals/v1`、同一模型配置和同一通过条件，分别保存 JSON/Markdown 结果；不能在看到结果后修改 fixture 迎合新 Prompt。

当前 `eval:fixed` 是零成本 deterministic 基线，主要验证合同、安全、证据机制和重复性。它本身不代表远程模型语言质量。远程 Prompt 对比应另做受控批次，并记录 prompt version、模型、调用数、失败数和各 case 机器断言；每个付费批次仍需遵守仓库的 20 请求上限和提前停止规则。
