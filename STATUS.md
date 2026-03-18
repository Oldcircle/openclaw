# OpenClaw 二开状态

> AI 每次开始工作前必须读这个文件。完成工作后必须更新。

## 当前进度

| 方向              | 状态   | 说明                                                                |
| ----------------- | ------ | ------------------------------------------------------------------- |
| trace-viewer 插件 | 已完成 | blob store + collector + API 已落地，3/17 真实 Gateway API 验证通过 |
| 核心 LLM hook     | 已完成 | 每轮 `llm_input`/`llm_output` hook，见 devlog 3/14                  |
| 资产化提示词系统  | 进行中 | P0-P3 已完成，P4/P5 待后续按需推进                                  |

## 资产化提示词系统进度

| 阶段 | 内容                   | 状态   | 备注                                                                                                                                    |
| ---- | ---------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | 基线与可观测性         | 已完成 | 3/17 通过真实 Gateway `/context detail` 记录基线                                                                                        |
| P1   | Context Book 基础版    | 已完成 | 全部 schema 字段已落地，3/17 真实 Gateway 验证通过（常驻注入 + 关键词触发 + tail_reminder + `/context detail` 统计）                    |
| P2   | Agent Card 基础版      | 已完成 | 3/17 真实 Gateway 验证通过（persona 替代 + depth_prompt）；`default_context_book` / `default_prompt_profile` 默认挂载均已接通           |
| P3   | Prompt Profile 基础版  | 已完成 | 模块注入 + 模型参数 + 工具范围/偏好 + 输出偏好 + final-tag + reply-tags + `openclaw profile use` CLI                                    |
| P4   | 高级预算治理与深度注入 | 进行中 | 已落地：可配置 `contextBookPromptBudgetPercent`、per-entry `scanDepth`/`tokenBudget`/`sticky`/`delay`；cooldown/excludeRecursion 待后续 |
| P5   | 资产导入导出           | 未开始 | import/export/UI 选择器                                                                                                                 |

## 当前待办

- [x] P0: 记录一次真实 `/context detail` 基线（3/17 完成）
- [x] P1: 设计 Context Book schema 和最小实现切入点
- [x] P1: 扩展到关键词触发
- [x] P1: 扩展到 `secondaryKeywords/secondaryLogic`
- [x] P1: 扩展到位置分层
- [x] P1: 扩展到基础预算控制
- [x] P1: 扩展到 `agentIds/channels/chatTypes/sessionKinds` 过滤
- [x] P1: 扩展到 `at_depth`
- [x] 把现有 bootstrap 文件清理项并入 P1 的前置整理
- [ ] 保留工具描述增强 / 尾部提醒作为 P4 的局部先行项
- [x] P2: Agent Card 最小兼容骨架（workspace 级 persona 资产优先，旧文件兜底）
- [x] P2: 扩展 `depth_prompt`
- [x] P2: 扩展 `default_context_book` 默认挂载
- [x] P2: 扩展 `default_prompt_profile` 自动挂载
- [x] P3: Prompt Profile 最小运行时骨架（workspace 级资产读取 + 默认挂载）
- [x] P3: 扩展 Prompt Profile 默认模型参数（`temperature` / `max_tokens`）
- [x] P3: 扩展工具偏好（tool scope + prefer）
- [x] P3: 扩展结构化输出格式偏好（output.format / sections / style / rules）
- [x] P3: 扩展 reply tags 控制（`off` / `current_only` / `allow_explicit`）
- [x] P3: `openclaw profile use` CLI 切换命令（3/17 完成并手动验证通过）
- [x] trace-viewer: 前端对接 blob API（在 trace-viewer 项目侧）
- [x] trace-viewer: live running trace 通过插件 API 暴露给前端
- [x] trace-viewer: 用真实 Gateway 验证 API 端点（health/list/detail/date-filter/status-filter 均通过，3/17）
- [x] P4: 可配置 `contextBookPromptBudgetPercent`（0-100，默认 25）
- [x] P4: per-entry `scanDepth`（条目专属关键词扫描深度）
- [x] P4: per-entry `tokenBudget`（条目专属字符预算上限）
- [x] P4: per-entry `sticky`（关键词在近 N 轮出现则保持激活，需配合 `scanDepth`）
- [x] P4: per-entry `delay`（会话满 N 轮用户消息后才激活）
- [ ] P4: `cooldown`（sticky 过期后冷却 N 轮，需 session 状态持久化）
- [ ] P4: `excludeRecursion` / `preventRecursion`（递归扫描控制，暂不需要）

## 已知问题

- Telegram 群组 policy 是 `allowlist` 但白名单为空（暂不需要群组功能）
- BOOTSTRAP.md 已删除，IDENTITY/SOUL/USER.md 已由"一号"自定义写入
- 旧版“系统提示词压缩”路线已降级为局部子任务，不再作为主线
- 新主线是资产化：Agent Card / Context Book / Prompt Profile
- ~~`loadAgentCardDocument` 返回 `[]` 导致 Agent Card 静默失效~~ → 已修复（3/17，`return []` → `return null`）
- `/context detail` 报告中 Agent Card 替代的文件只显示 name 不显示来源路径，不够直观（低优先级）

## 最新进展（2026-03-18）

### 3/18: P4 批量推进 — 预算配置化 + 条目生命周期控制

- **`contextBookPromptBudgetPercent` 可配置化**：
  - 从硬编码 25% 升级为 `agents.defaults.contextBookPromptBudgetPercent`（0-100）
  - config schema、help text、labels、Zod 校验均已接入
  - `/context detail` 显示百分比
- **Per-entry `scanDepth`**：
  - 条目专属关键词扫描深度，只扫描最近 N 条消息
  - 用于限制关键词触发的时间窗口（如只看最近一条消息）
- **Per-entry `tokenBudget`**：
  - 条目专属字符预算上限，超出时自动截断内容
  - 防止单个大条目占满全局预算
- **Per-entry `sticky`**：
  - 关键词在近 N 轮出现则保持条目激活（扫描 `sticky*2` 条消息）
  - 需配合 `scanDepth` 使用（否则全量扫描已覆盖 sticky 窗口）
  - 无状态实现：基于消息回溯而非 session 持久化
- **Per-entry `delay`**：
  - 会话满 N 轮用户消息后才允许条目激活
  - 基于 `messages` 中 user role 消息计数，无状态
- **测试覆盖**：所有新字段均有独立测试用例，115 个相关测试全部通过

## 之前进展（2026-03-17）

### 3/17: Prompt Profile `reply_tags` 接通到 system prompt / 运行时解析 / `/context detail`

- **P3 继续推进**：
  - 新增 `Prompt Profile.output.reply_tags`，支持 `off` / `current_only` / `allow_explicit`
  - system prompt 的 `Reply Tags` 段现在会按 profile 策略切换：可禁用 reply tags，或限制为只允许 `[[reply_to_current]]`
  - 运行时 reply-tag 解析已接入同一策略：当 profile 禁用或限制 reply tags 时，输出中的 `[[reply_to_*]]` 会被剥离并按策略决定是否真正参与线程回复
  - `/context detail`、system prompt report 和命令侧 prompt estimate 已显示 Prompt Profile 的 reply-tag 策略
- **回归修复**：
  - block reply 回调改为同步调用 + Promise 兜底捕错，修复相关流式 block reply 测试的时序回归
- **本地验证通过**：
  - `pnpm exec vitest run src/utils/directive-tags.test.ts src/auto-reply/reply/reply-utils.test.ts src/agents/prompt-profiles.test.ts src/agents/system-prompt.test.ts src/agents/system-prompt-report.test.ts src/auto-reply/reply/commands-context-report.test.ts src/auto-reply/reply/commands-system-prompt.test.ts src/agents/pi-embedded-runner/run/payloads.test.ts src/agents/pi-embedded-subscribe.reply-tags.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.emits-block-replies-text-end-does-not.test.ts src/agents/pi-embedded-subscribe.block-reply-rejections.test.ts`

### 3/17: `openclaw profile use` 已接通 workspace Agent Card 默认切换

- **P3 继续推进**：
  - 新增 CLI：`openclaw profile use <name>`，会把选中的 Prompt Profile 写入当前 agent workspace 的 `agent-card.{yaml,yml,json}` `default_prompt_profile`
  - 复用运行时同一套 profile 选择规则：支持按文件名或去扩展名匹配 `prompt-profiles/*.yaml|yml|json`
  - 若 workspace 尚无 Agent Card，会自动创建 `agent-card.yaml`
  - 若已有 `agent-card.json` 或 `agent-card.yml`，会保留原文件格式并仅更新默认 profile 字段
- **本地验证目标**：
  - 覆盖了 CLI 接线、命令层 profile 校验、以及 YAML/JSON Agent Card 写回

### 3/17: P3 位置写法与文档对齐

- **文档核对结论**：
  - `PLAN.md` 里关于 Prompt Profile position 的概念层写法（`head` / `before_history` / `after_history` / `tail`）和运行时 schema 名称（`before_context` / `after_context` / `tail_reminder` / `at_depth`）原先混在一起，容易让实际配置写错
- **已继续推进**：
  - Prompt Profile position 解析现在兼容上述概念层别名，并在运行时归一化到现有 schema
  - 文档已改成“概念层名称 + 运行时映射”的写法，避免误导后续配置

### 3/17: P4 起步 - Context Book prompt budget 进入运行时与 `/context detail`

- **P4 开始落地**：
  - Context Book prompt budget 不再只是 `resolveContextBookPromptContext()` 里的隐藏常量；运行时现在会按模型上下文窗口、max output tokens 和当前 system prompt 体积动态计算 prompt budget
  - `systemPromptReport.contextBooks` 新增 prompt budget / used chars / skipped entries 字段
  - `/context detail` 已显示 Context Book prompt budget、已使用体积，以及因预算超限被跳过的条目
- **本地验证通过**：
  - `pnpm exec vitest run src/agents/context-books.test.ts src/auto-reply/reply/commands-context-report.test.ts src/agents/system-prompt-report.test.ts`
  - `pnpm exec vitest run src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/context-books.test.ts src/auto-reply/reply/commands-context-report.test.ts src/agents/prompt-profiles.test.ts`

### 3/17: 真实 Gateway 端到端验证 + Prompt Profile 工具偏好 / 输出偏好 / final-tag + bugfix

- **首次端到端验证**：从 fork 源码启动 Gateway，通过 Telegram 对话和 `/context detail` 验证 P1 + P2 功能
- **P1 Context Book 验证通过**：
  - 常驻条目（`alwaysActive` + `before_context`）正常注入到 bootstrap files
  - 关键词触发条目正常命中
  - `tail_reminder` 条目正常命中
  - `/context detail` 正确显示 Context Book 统计、命中条目、at_depth 概览
- **P2 Agent Card 验证通过**：
  - `agent-card.yaml` 被正确读取，synthetic IDENTITY/SOUL/USER 替代了旧文件（体积和内容均变化）
  - 修改 Agent Card 内容后无需重启 Gateway 即生效（每轮实时读取）
- **P2 继续推进**：
  - `default_context_book` 已接入真实默认挂载链路：bootstrap 常驻注入与运行期关键词注入都会优先只加载 Agent Card 指定的 Context Book
  - 支持按文件名或去扩展名的资产名匹配 `context-books/*.yaml|yml|json`
  - 若 Agent Card 指定的默认 Context Book 不存在，会在日志中告警并回退到现有“加载全部 Context Book”的兼容行为
- **P3 Prompt Profile 最小可用版已落地**：
  - 新增 workspace 级 `prompt-profiles/*.yaml|yml|json` 资产读取
  - `Agent Card.default_prompt_profile` 已驱动真实默认挂载
  - 已支持最小模块 schema：`enabled` / `content` / `position` / `depth` / `order`
  - 已支持 `before_context` / `after_context` / `tail_reminder` / `at_depth` 注入，并通过现有 system context / at_depth 链路接入运行时
  - `/context detail` 已显示当前 Prompt Profile、启用模块和 at_depth 模块体积
  - 已支持 `temperature` / `max_tokens` 作为运行时默认 stream params；显式 run-level overrides 仍优先于 profile 默认值
  - 已支持 `tools.allow` / `tools.deny` 缩小最终可用工具集，仍遵守现有 operator / agent / provider / sandbox policy 交集
  - 已支持 `tools.prefer` 注入工具偏好提示，作为独立 Prompt Profile 区块进入 system context
  - 已支持 `output.format` / `output.sections` / `output.style` / `output.rules`，作为结构化 Output Preferences 区块注入 system context
  - 已支持 `output.require_final_tag`，会复用现有 `<final>...</final>` 严格模式并真实影响输出裁剪
  - `/context detail` 与命令侧 prompt estimate 已显示 Prompt Profile 的 tool scope / preferred tools / output preferences，并按该 scope 计算工具列表
- **bugfix**: `loadAgentCardDocument` 在文件读取失败时返回 `[]` 而非 `null`，导致 Agent Card 静默失效（已修复并推送）
- **P0 基线已记录**：通过 `/context detail` 获取了完整的 system prompt 结构基线

### 3/16 及之前

- `src/agents/context-books.ts`
  - 新增 `Context Book` 资产读取与解析
  - 已支持 `alwaysActive`、`keywords`、`secondaryKeywords/secondaryLogic`
  - 已支持 `before_context / after_context / tail_reminder / at_depth`
  - 已支持 `group / groupWeight` 同组互斥与组内加权选择
  - 已支持 `agentIds / channels / chatTypes / sessionKinds`
  - 已支持运行期 system context 独立预算与 `ignoreBudget`
  - `at_depth` 条目会在本轮 prompt 前临时插入历史并在完成后剥离，不污染持久 session
- `src/agents/bootstrap-files.ts`
  - 常驻 `Context Book` 条目已接入 bootstrap 管线
- `src/agents/pi-embedded-runner/run/attempt.ts`
  - 关键词触发条目已接入运行期 prompt build，按消息内容动态注入 system context
  - `at_depth` 条目会在本轮 prompt 前临时插入历史并在完成后剥离，不污染持久 session
- `src/agents/workspace.ts`
  - onboarding 完成后不再为缺失的 `BOOTSTRAP.md` 注入 missing marker
  - 当 workspace 已有 `context-books/` 资产时，不再为缺失的 `SOUL.md / IDENTITY.md / USER.md` 注入 missing marker，减少旧槽位噪音
- `src/agents/system-prompt-report.ts`
  - `systemPromptReport` 已新增 `contextBooks` 区块，统计 Project Context 中的 Context Book 条目体积
- `src/auto-reply/reply/commands-context-report.ts`
  - `/context list` 与 `/context detail` 已显示 Context Book 摘要、最近一轮命中条目，以及 `at_depth` 条目概览
- `src/agents/agent-card.ts`
  - 新增 workspace 级 `Agent Card` 读取，支持 `agent-card.yaml` / `agent-card.yml` / `agent-card.json`
  - 当前会把 `identity` / `personality` / `tone` / `behavior_notes` / `example_dialogues` / `user_relationship` 合成为兼容旧 bootstrap 槽位的 synthetic `IDENTITY.md` / `SOUL.md` / `USER.md`
  - 已支持读取 `depth_prompt`，并转换为运行期 `at_depth` 注入条目
  - 已支持把 `default_context_book` 解析为运行时默认资产选择
- `src/agents/bootstrap-files.ts`
  - 当存在 `Agent Card` 时，对应 persona 槽位会优先使用 synthetic bootstrap 文件；未定义字段仍回退到旧 `SOUL.md / IDENTITY.md / USER.md`
  - bootstrap 常驻 Context Book 注入已受 `Agent Card.default_context_book` 控制
- `src/agents/pi-embedded-runner/run/attempt.ts`
  - `Agent Card depth_prompt` 已接入运行期，与 `Context Book at_depth` 共用同一条历史注入链路
  - 运行期关键词触发 Context Book 注入已受 `Agent Card.default_context_book` 控制
- `src/agents/prompt-profiles.ts`
  - 新增 workspace 级 `Prompt Profile` 资产解析与运行时注入
  - 已支持 `before_context / after_context / tail_reminder / at_depth` 模块位置
  - 已支持读取 `temperature` / `max_tokens` 作为 profile 级默认模型参数
  - 已支持 `tools.allow` / `tools.deny` / `tools.prefer`
  - 已支持 `output.format` / `output.sections` / `output.style` / `output.rules`
- `src/agents/pi-embedded-runner/run/attempt.ts`
  - `Agent Card.default_prompt_profile` 已接入运行期 Prompt Profile 默认挂载
  - Prompt Profile 默认模型参数会在运行期合并进 stream params，且显式 run-level overrides 优先
  - Prompt Profile tool scope 会在建 tool list 前接入现有 tool-policy pipeline
- `src/agents/system-prompt-report.ts`
  - `systemPromptReport` 已新增 `promptProfiles` 区块，记录 profile 名称、模块体积、默认 stream params、tool scope / preferred tools、output preferences 和 at_depth 模块
- `src/auto-reply/reply/commands-context-report.ts`
  - `/context list` 与 `/context detail` 已显示 Prompt Profile 摘要、默认 stream params、tool scope / preferred tools、output preferences、模块列表与 at_depth 模块
- `src/agents/system-prompt.ts`
  - `Project Context` 中对 `SOUL.md` 的 persona 提示已兼容 synthetic `agent-card.*#SOUL.md` 路径
- 本地验证补充通过：
  - `pnpm exec vitest run src/agents/bootstrap-files.test.ts src/agents/system-prompt.test.ts`
  - `pnpm exec vitest run src/agents/agent-card.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts`
  - `pnpm exec vitest run src/agents/agent-card.test.ts src/agents/context-books.test.ts src/agents/bootstrap-files.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts`
  - `pnpm exec vitest run src/agents/prompt-profiles.test.ts src/agents/system-prompt-report.test.ts src/auto-reply/reply/commands-context-report.test.ts`
  - `pnpm exec vitest run src/agents/pi-tools.prompt-profile-tool-policy.test.ts src/auto-reply/reply/commands-system-prompt.test.ts`
  - `pnpm exec vitest run src/agents/prompt-profiles.test.ts src/agents/system-prompt-report.test.ts src/auto-reply/reply/commands-context-report.test.ts src/auto-reply/reply/commands-system-prompt.test.ts`

- `extensions/trace-viewer/src/collector.ts`
  - `list()` 现在会把 active trace 和已落盘 trace 合并返回
  - `get()` 现在支持返回 running / draft 中的 live detail
  - terminal trace 在真正落盘前不再经由 live 通道返回，避免 completed 已显示但 blob 尚未 flush 的短暂不一致
- `extensions/trace-viewer/src/storage.ts`
  - 新增 `listMatchingTraces()`，把过滤匹配和分页拆开，供 collector 合并 live trace 使用
- `extensions/trace-viewer/src/collector.test.ts`
  - 新增 active trace live list/get 回归测试
- 本地验证通过：
  - `pnpm exec vitest run extensions/trace-viewer/src/collector.test.ts extensions/trace-viewer/src/storage.test.ts`

## 环境

- Gateway: `http://localhost:18789`
- 分支: `dev/main`
- 上次上游同步: 2026-03-13 (f07033ed3)
