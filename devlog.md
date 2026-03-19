# OpenClaw 二开流水账

> 按时间倒序记录每次改了什么，为什么改。AI 读这个了解最新进度。

---

## 2026-03-19

### 第三阶段：经验资产 E1-E3 + 经验触发修复

#### 经验触发修复（天气查询未遵守经验规则）

**问题**：经验资产被正确提取并写入 `learned.yaml`，关键词匹配也成功注入了 system prompt，但 deepseek-chat 未遵守注入的经验指令（仍然每次询问城市）。

**根因分析**：

1. 经验条目使用 `position: after_context`，在 system prompt 中段注入，deepseek 对中段指令遵从度低
2. 经验内容以描述性语气书写（"记住用户偏好"），缺乏命令强度
3. 无 hitCount 追踪，无法验证经验是否真正被注入

**三项修复**：

1. **注入位置升级**：`after_context` → `tail_reminder`（尾部提醒，模型遵从度最高）
2. **内容格式强化**：LLM 提取 prompt 新增指令要求使用 "MUST/ALWAYS/NEVER" 命令式语气；内容前缀 `[经验规则]` 标签
3. **E3 hitCount 追踪**：命中时自动更新 `hitCount += 1` 和 `lastHitAt`，fire-and-forget

#### E1: Context Book schema 扩展

- 修改 `src/agents/context-books.ts`
  - `NormalizedContextBookEntry` 新增 6 个可选字段：`source`、`sourceSession`、`confidence`、`hitCount`、`lastHitAt`、`situation`
  - 新增 `parseConfidence()` 解析函数
  - `confidence: "deprecated"` 的条目在 normalization 阶段跳过（不注入 prompt）
- 修改 `src/agents/assets.ts`
  - `validateContextBookEntry()` 新增 6 个字段的类型校验，不报 unknown field 警告

#### E2: session-memory hook 扩展

- 新建 `src/hooks/bundled/session-memory/experience-extractor.ts`
  - `extractExperienceFromSession()`：调 LLM 分析对话，提取经验规则
  - LLM prompt 要求识别"纠正→成功"、"用户偏好"、"非显然解法"三种模式
  - LLM prompt 强制要求结论使用命令式语气（MUST/ALWAYS/NEVER）
  - 解析 LLM 返回的 YAML（name/keywords/situation/conclusion）
  - 追加到 `context-books/learned.yaml`，默认 `confidence: low`、`order: 30`、`position: tail_reminder`
  - 内容自动添加 `[经验规则]` 前缀标签
- 修改 `src/hooks/bundled/session-memory/handler.ts`
  - 在 memory 文件写入后调用 `extractExperienceFromSession()`
  - 复用已有的 `allowLlm` 判断（测试环境跳过）
  - 错误不中断主流程（try-catch 保护）

#### E3: 经验命中追踪

- 修改 `src/agents/context-books.ts`
  - `resolveContextBookPromptContext()` 在匹配完成后，对 `source: auto` 的命中条目执行 fire-and-forget 回写
  - 新增 `trackExperienceHits()`：基于文本正则更新 `learned.yaml` 中的 `hitCount` 和 `lastHitAt`
  - 保留原有 YAML 格式和注释，不重新序列化整个文件

### 第二阶段：提示词精简 S1-S4

**动机**：第一阶段资产化系统（P0-P5）建了条件注入通道，但旧的全量注入原封不动，等于只加不减。开始第二阶段真正压缩 token。

#### S1: 空文件不注入

- 修改 `src/agents/pi-embedded-helpers/bootstrap.ts`
  - `buildBootstrapContextFiles()` 中 `file.missing` 直接 `continue`，不再注入 `[MISSING] Expected at:` 占位文本
  - 原逻辑会为不存在的 BOOTSTRAP.md 等注入无信息量的 missing marker

#### S3: Skill 列表压缩

- 修改 `src/agents/skills/workspace.ts`
  - 新增本地 `formatSkillsForPrompt()` 函数，输出表格格式（每 skill 1 行）
  - 不再从 `@mariozechner/pi-coding-agent` 导入同名函数（外部包输出 XML，每 skill 5 行）
  - 8 个 skill 从 ~56 行压缩到 ~10 行

#### S4: AGENTS.md 精简

- 修改 `~/.openclaw/workspace/AGENTS.md`（workspace 文件，非代码）
  - 213 行 → ~50 行
  - 精简原则：删教学段落、emoji 装饰、JSON 示例、人类类比；只保留规则条目
  - 心跳 82 行教程 → 8 行规则
  - 群聊 47 行教学 → 5 行行为规则
  - Memory 28 行教学 → 5 行文件规则

#### S2: 去重合并

- 无代码改动——S4 精简后，AGENTS.md 与核心区 system-prompt.ts 的重复（Safety、Heartbeat、Memory）自然消除

#### Bugfix: Message ordering conflict

- 修改 `src/agents/pi-embedded-runner/run/attempt.ts`
  - 问题：API 返回错误时，空 assistant 消息（`stopReason: "error"`, `content: []`）被持久化到 session，导致后续消息历史角色不交替
  - 根因：清理逻辑只检查 `stopReason === "aborted"`，没覆盖 `"error"`
  - 修复：两处条件扩展为 `(stopReason === "aborted" || stopReason === "error")`
  - 真实触发：DeepSeek 3/17（`tool role without tool_calls`）、Gemini 3/5（空响应）

#### S5: 条件注入替代全量注入

- 修改 `~/.openclaw/workspace/AGENTS.md`
  - 移除 Group Chats 段（5 行）和 Heartbeats 段（8 行）
  - 这些内容不再每轮全量注入，改为 Context Book 条件触发
  - AGENTS.md 进一步精简到 ~32 行
- 新建 `~/.openclaw/workspace/context-books/system-guidance.yaml`
  - 群聊行为规则：`chatTypes: ["group"]` — 只在群聊时注入
  - 心跳执行规则：`keywords: ["heartbeat", ...]` — 只在心跳相关消息时注入
  - Memory 操作规则：`keywords: ["memory", "记忆", ...]` — 只在记忆相关话题时注入
  - Cron 使用规则：`keywords: ["cron", "定时", ...]` — 只在定时任务话题时注入

### 验证

- `pnpm test`：921 文件 / 7599 测试全部通过
- `openclaw assets validate`：all assets validated, no issues

---

## 2026-03-18

### P4 批量推进：预算配置化 + 条目生命周期控制

- 修改 `src/agents/context-books.ts`
  - `contextBookPromptBudgetPercent`：从硬编码 `0.25` 升级为可配置百分比（0-100），通过 `agents.defaults.contextBookPromptBudgetPercent` 设置
  - 新增 `resolveContextBookPromptBudgetPercent()` 从 config 读取并 clamp 到 0-100
  - `calculateContextBookPromptMaxChars()` 接受 `budgetPercent` 参数
  - 新增 `scanDepth` 字段：per-entry 关键词扫描深度，只扫描最近 N 条消息
  - 新增 `tokenBudget` 字段：per-entry 字符预算上限，在 `selectPromptEntriesWithinBudget` 中截断超限内容
  - 新增 `sticky` 字段：当关键词在近 `sticky*2` 条消息中出现时保持条目激活（需配合 `scanDepth` 使用）
  - 新增 `delay` 字段：会话满 N 轮用户消息后才允许条目激活
  - `shouldInjectViaPromptContext` 重构为接受 `messages` + `turnCount` 参数
  - `buildMessageKeywordHaystack` 支持可选 `scanDepth` 参数
- 修改 `src/agents/pi-embedded-runner/run/attempt.ts`
  - 运行时读取 `contextBookPromptBudgetPercent` 并传入预算计算
- 修改 `src/auto-reply/reply/commands-context-report.ts`
  - `/context detail` 显示 Context Book prompt budget 百分比
- 修改 config schema 相关文件
  - `src/config/types.agent-defaults.ts`：新增 `contextBookPromptBudgetPercent` 字段
  - `src/config/zod-schema.agent-defaults.ts`：Zod 校验（`z.number().int().min(0).max(100)`）
  - `src/config/schema.help.ts`、`src/config/schema.labels.ts`：help text 和 label
  - `src/config/sessions/types.ts`：`systemPromptReport.contextBooks` 新增 `promptBudgetPercent`

### 验证

- `pnpm exec vitest run src/agents/context-books.test.ts src/auto-reply/reply/commands-context-report.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/system-prompt-report.test.ts src/agents/bootstrap-files.test.ts`
- 115 个测试全部通过

---

## 2026-03-17

### Prompt Profile：结构化输出偏好

- 修改 `src/agents/prompt-profiles.ts`
  - 新增 `output.format` / `output.sections` / `output.style` / `output.rules` 解析
  - 结构化输出偏好会生成独立的 Prompt Profile Output Preferences 区块注入 system context
- 修改 `src/agents/pi-embedded-runner/run/attempt.ts`
  - 新增 `output.require_final_tag` 到运行时合并逻辑，可直接驱动现有 `<final>...</final>` 严格模式
- 修改 `src/agents/system-prompt-report.ts`、`src/auto-reply/reply/commands-context-report.ts`
  - `/context detail` 新增 Prompt Profile output preferences 可观测性
- 补充测试：
  - `src/agents/prompt-profiles.test.ts`
  - `src/agents/system-prompt-report.test.ts`
  - `src/auto-reply/reply/commands-context-report.test.ts`
  - `src/agents/pi-embedded-runner/run/attempt.test.ts`

### 验证

- `pnpm exec vitest run src/agents/prompt-profiles.test.ts src/agents/system-prompt-report.test.ts src/auto-reply/reply/commands-context-report.test.ts src/auto-reply/reply/commands-system-prompt.test.ts`
- `pnpm exec vitest run src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/pi-tools-agent-config.test.ts`

### Prompt Profile：工具范围收缩 + 工具偏好

- 修改 `src/agents/prompt-profiles.ts`
  - 新增 `tools.allow` / `tools.deny` / `tools.prefer` 解析
  - `tools.prefer` 会生成独立的 Prompt Profile Tool Preferences 区块注入 system context
- 修改 `src/agents/pi-tools.ts`
  - Prompt Profile tool scope 会接入既有 tool-policy pipeline，只做“缩小工具集”，不会绕过 operator / agent / sandbox 限制
- 修改 `src/agents/pi-embedded-runner/run/attempt.ts`
  - 运行前先解析 Agent Card / Prompt Profile，并在构建 tool list 时应用 Prompt Profile tool scope
- 修改 `src/auto-reply/reply/commands-system-prompt.ts`
  - `/context` 相关命令的 system prompt estimate 也会按 Prompt Profile tool scope 计算工具列表
- 修改 `src/agents/system-prompt-report.ts`、`src/auto-reply/reply/commands-context-report.ts`
  - `/context detail` 新增 Prompt Profile 的 tool scope / preferred tools 可观测性
- 新增测试：
  - `src/agents/pi-tools.prompt-profile-tool-policy.test.ts`
  - `src/auto-reply/reply/commands-system-prompt.test.ts`

### 验证

- `pnpm exec vitest run src/agents/prompt-profiles.test.ts src/agents/system-prompt-report.test.ts src/agents/pi-tools.prompt-profile-tool-policy.test.ts src/auto-reply/reply/commands-context-report.test.ts src/auto-reply/reply/commands-system-prompt.test.ts`
- `pnpm exec vitest run src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/pi-tools-agent-config.test.ts`

## 2026-03-16

### trace-viewer：active trace live 暴露

- 修改 `extensions/trace-viewer/src/storage.ts`：新增 `listMatchingTraces()`，把“读取并过滤 summary”与“分页”拆开
- 修改 `extensions/trace-viewer/src/collector.ts`
  - `list()` 现在会合并内存中的 active trace 与已落盘 trace
  - `get()` 现在支持读取 running / draft 中的 live detail
  - terminal trace 在真正持久化完成前不再通过 live 通道返回，避免刚完成时列表先看到 `completed` 但 blob 仍未 flush 的短暂不一致
- 修改 `extensions/trace-viewer/src/collector.test.ts`
  - 新增“trace 在持久化前即可被 list/get 看到”的回归测试

### 目的

解决 Prompt Debugger 联调时的核心体验问题：在 `Control` 页面发送消息后，trace-viewer 列表和详情页无法及时看到 running 中的 trace，必须等最终落盘才出现。

### 验证

- `pnpm exec vitest run extensions/trace-viewer/src/collector.test.ts extensions/trace-viewer/src/storage.test.ts`
- 通过（2 个测试文件，9 个测试）

## 2026-03-15

### BlobStore 内容寻址存储

- 新建 `extensions/trace-viewer/src/blob-store.ts`：SHA-256 内容寻址存储，`putSync()` 同步缓冲 + `flushPending()` 批量写盘
- 新建 `extensions/trace-viewer/src/blob-store.test.ts`：7 个单元测试
- 修改 `extensions/trace-viewer/src/types.ts`：`PromptSection` / `HistoryMessageSummary` 增加 `contentRef?`，`LlmInputStep` 增加 `systemPromptRef?`
- 修改 `extensions/trace-viewer/src/collector.ts`：集成 BlobStore，system prompt / prompt sections / history messages 内容全部存为 blob，`persistAndClose` 先 flush blobs 再写 trace
- 修改 `extensions/trace-viewer/src/api.ts`：新增 `GET /plugins/trace-viewer/blobs/:hash` 端点
- 修改 `extensions/trace-viewer/index.ts`：初始化 BlobStore 传给 collector
- 修改 `extensions/trace-viewer/src/collector.test.ts`：新增 2 个 blob 集成测试

### 目的

解决 trace-viewer 侧边面板两个问题：

1. 历史消息无完整内容（只有摘要，点击显示"完整内容暂不可用"）
2. promptSections 无 content（只有 name/chars/category）

直接保存完整内容会导致大量重复（system prompt 每轮重复，历史消息累积重复）。采用内容寻址去重存储后，同一内容只存一份 blob。

### 验证

- 真实 Telegram 消息测试：128 blob 文件，4 轮 LLM 的 systemPromptRef 相同（去重生效）
- blob API 正常返回内容
- 所有 12 个测试通过（7 blob-store + 5 collector）

### timeout / 孤儿 trace 修复

- 修改 `extensions/trace-viewer/src/collector.ts`：为超时 trace 增加 continuation 续接窗口，允许同一 session 在新 `runId` 下继续归并到原 trace
- 修改 `extensions/trace-viewer/src/collector.ts`：late `agent_end` 到达时，会把原 `timed_out` trace 升级成最终状态，而不是永久停在超时
- 修改 `extensions/trace-viewer/src/collector.test.ts`：新增 timeout 后跨 `runId` 续接、late `agent_end` 收口回归测试

### 目的

解决 trace-viewer 中的 `(empty)` 孤儿 trace 和“明明最终完成却停在 timed_out”的问题。

### 验证

- 定向测试通过：`pnpm exec vitest run extensions/trace-viewer/src/collector.test.ts extensions/trace-viewer/src/storage.test.ts`
- 真实本地落盘验证：长任务 trace 最终写回 `completed`，不再继续生成新的 `(empty)` 孤儿 trace

---

## 2026-03-14

### trace-viewer / 方案 A

- 在 `extensions/trace-viewer/` 落了第一版 collector、storage、HTTP API 和基础测试
- 在 `projects/ai/trace-viewer/STATUS.md` 统一记录多 agent 共享开发状态，避免进度文档分裂

### 核心改动：每轮 LLM hook

- 修改 `src/agents/pi-embedded-runner/run/attempt.ts`
- 修改 `src/agents/pi-embedded-subscribe.ts`
- 修改 `src/agents/pi-embedded-subscribe.handlers.*`
- 让 `llm_input` / `llm_output` 从“每个 run 触发一次”改为“agentic loop 每轮 assistant 调用各触发一次”
- 首轮 `llm_input.prompt` 保留 hook 注入后的完整 prompt，后续轮次从历史消息推导；若最后一条不是 user，则 prompt 为空字符串

### 验证

- 补了 `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.subscribeembeddedpisession.test.ts`
- 新增 `extensions/trace-viewer/src/collector.test.ts`
- 新测试顺带暴露并修复了 `extensions/trace-viewer/src/collector.ts` 中 token 汇总调用写成 `this.addUsage(...)` 的 bug
- 目标是确保同一 run 的多轮 LLM 调用能被 trace-viewer 正确落盘，而不是只保留最后一轮

### 备注

- 这是为了支撑 trace-viewer 的核心诊断价值，不是泛化“更多 hook 更好”
- 下一步是用真实 Gateway/Telegram 场景验证：一个 run 是否能稳定产出多组 `llm_input` + `llm_output`

---

## 2026-03-13

### 上游同步

- 从上游同步 1465 个 commit（9d941949c → f07033ed3）
- 跨越 3 个 release：v2026.3.8 → v2026.3.11 → v2026.3.12（当前 HEAD 为 v2026.3.13-dev）
- 合并无冲突（仅 AGENTS.md 自动合并）
- 重新安装依赖 + 构建成功

### 上游主要变更摘要

**新功能**

- Control UI/Dashboard v2 全面重构（模块化视图、命令面板、移动端底部导航）
- OpenAI GPT-5.4 / Anthropic Claude fast mode 支持
- Ollama/vLLM/SGLang 迁移到 provider-plugin 架构
- Kubernetes 部署支持（raw manifests + Kind）
- Subagents `sessions_yield` 原语
- Slack Block Kit 消息支持
- iOS Home canvas + push relay
- macOS chat model picker + thinking-level 持久化
- Ollama 一键 onboarding（Local / Cloud+Local 模式）
- Memory 多模态图片/音频索引（Gemini embedding-2-preview）
- ACP session resume 支持

**安全修复（大量）**

- 设备配对改用短期 bootstrap token
- 禁用隐式 workspace plugin 自动加载
- WebSocket origin 校验加固
- exec approval Unicode 逃逸防护
- 多个 GHSA 安全公告修复（pairing scope、preauth payload、Feishu/LINE/Zalo webhook 等）

**其他修复**

- Kimi Coding tool call 格式修复
- Telegram 消息去重 / 预览发送 / 轮询重启隔离
- Windows gateway install 回退策略
- macOS launchd restart 加固
- 大量 channel/plugin/routing 修复

---

## 2026-03-08

### 环境搭建

- 克隆 fork，添加 upstream remote
- 安装依赖：`pnpm install`
- 配置 `.env`，设置 Gateway Token
- 工具 profile 改为 `full`，解除 AI 助手的工具限制
- 配置了 Telegram 频道，绑定了"一号" AI 助手（gemini-3.1-pro-high via Antigravity Manager）
- 创建 `dev/main` 二开分支

### 当前运行状态

- Gateway: `http://localhost:18789`
- Token: 见 `.env` 的 `OPENCLAW_GATEWAY_TOKEN`
- Telegram bot 已激活，已批准 TG 用户 8709323458

### 已知问题 / 待优化

- Telegram 群组 policy 是 `allowlist` 但白名单为空，群组消息被静默丢弃（暂不需要群组功能所以忽略）
- BOOTSTRAP.md 已删除，IDENTITY/SOUL/USER.md 已由"一号"自定义写入

---

_新记录写在最上面_
