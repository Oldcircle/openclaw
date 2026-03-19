# OpenClaw 二开状态

> AI 每次开始工作前必须读这个文件。完成工作后必须更新。

## 当前进度

| 方向                       | 状态         | 说明                                                                        |
| -------------------------- | ------------ | --------------------------------------------------------------------------- |
| trace-viewer 插件          | 已完成       | blob store + collector + API 已落地，3/17 真实 Gateway API 验证通过         |
| 核心 LLM hook              | 已完成       | 每轮 `llm_input`/`llm_output` hook，见 devlog 3/14                          |
| 第一阶段：资产化提示词系统 | 已完成       | P0-P5 全部完成（Agent Card / Context Book / Prompt Profile + CLI 资产管理） |
| 第二阶段：提示词精简       | S1-S5 完成   | baseline 精简 62%（504→~200 行）+ Message ordering conflict 修复            |
| **第三阶段：经验资产**     | **规划完成** | **从对话中自动提炼可复用经验，作为 Context Book 自动化层，详见 PLAN.md**    |

## 第二阶段：提示词精简进度

> 核心问题：第一阶段建了条件注入通道但没减少旧的全量注入，等于只加不减。本阶段用新通道替代旧通道，并精简 baseline。

| 步骤 | 内容                                                   | 预估节省     | 状态   | 备注                                                 |
| ---- | ------------------------------------------------------ | ------------ | ------ | ---------------------------------------------------- |
| S1   | 空文件不注入（missing 文件跳过 `[MISSING]` 标记）      | ~800 token   | 已完成 | `buildBootstrapContextFiles` 直接 skip missing files |
| S2   | 去重合并（Safety×2, Heartbeat×3, Memory×2）            | ~1,500 token | 已完成 | S4 精简后重复自然消除（核心区与 AGENTS.md 不再重叠） |
| S3   | Skill 列表从 XML 压缩为单行表格                        | ~700 token   | 已完成 | `formatSkillsForPrompt` 本地重写，每 skill 1 行表格  |
| S4   | AGENTS.md 教学内容精简（213 行→~50 行）                | ~2,000 token | 已完成 | workspace AGENTS.md 精简，删除教学段/emoji/示例代码  |
| S5   | 条件注入替代全量注入（群聊/心跳/Memory/Cron 按需注入） | ~1,000 token | 已完成 | AGENTS.md 拆分 + system-guidance.yaml CB             |
| S6   | 延迟加载 Skills/工具描述                               | 待定         | 长期   | S1-S5 完成后评估                                     |

**实施顺序**：~~S1~~ → ~~S4~~ → ~~S2~~ → ~~S3~~ → ~~S5~~ （S1-S5 全部完成）

## 第三阶段：经验资产进度

> 核心思路：经验不是新的资产类型，而是 Context Book 的自动化层。触发时机复用已有的 session-memory hook 和用户主动指令。

| 步骤 | 内容                                                              | 状态   | 备注                                                                                     |
| ---- | ----------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| E1   | Context Book schema 扩展（source/confidence/hitCount 等可选字段） | 已完成 | 类型 + 解析 + 校验 + deprecated 跳过                                                     |
| E2   | session-memory hook 扩展（/new 时顺便提取经验）                   | 已完成 | experience-extractor.ts + handler.ts 集成；position 改 tail_reminder；内容强化命令式语气 |
| E3   | 经验命中追踪（命中时更新 hitCount/lastHitAt）                     | 已完成 | resolveContextBookPromptContext 中 fire-and-forget 回写 learned.yaml                     |
| E6   | 用户主动触发（"记录一下"/"整理笔记"）                             | 待开始 |                                                                                          |
| E4   | 置信度演进（low→medium→high→proven + 降级废弃）                   | 待开始 |                                                                                          |
| E5   | 经验内容更新（命中但仍被纠正时补充 conclusion）                   | 待开始 |                                                                                          |

**实施顺序**：~~E1~~ → ~~E2~~ → ~~E3~~ → E6 → E4 → E5

## 资产化提示词系统进度

| 阶段 | 内容                   | 状态     | 备注                                                                                                                           |
| ---- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| P0   | 基线与可观测性         | 已完成   | 3/17 通过真实 Gateway `/context detail` 记录基线                                                                               |
| P1   | Context Book 基础版    | 已完成   | 全部 schema 字段已落地，3/17 真实 Gateway 验证通过（常驻注入 + 关键词触发 + tail_reminder + `/context detail` 统计）           |
| P2   | Agent Card 基础版      | 已完成   | 3/17 真实 Gateway 验证通过（persona 替代 + depth_prompt）；`default_context_book` / `default_prompt_profile` 默认挂载均已接通  |
| P3   | Prompt Profile 基础版  | 已完成   | 模块注入 + 模型参数 + 工具范围/偏好 + 输出偏好 + final-tag + reply-tags + `openclaw profile use` CLI                           |
| P4   | 高级预算治理与深度注入 | 核心完成 | 已落地：`contextBookPromptBudgetPercent`、per-entry `scanDepth`/`tokenBudget`/`sticky`/`delay`；cooldown/excludeRecursion 待定 |
| P5.1 | CLI 资产管理基础       | 已完成   | `openclaw assets list` / `openclaw assets validate` + CLI 注册 + 26 个测试通过                                                 |
| P5.2 | Export / Import        | 已完成   | `openclaw assets export` / `openclaw assets import` + \_meta 元数据头 + 类型自动识别 + 9 个测试通过                            |
| P5.3 | 旧 workspace 迁移      | 已完成   | `openclaw assets migrate` + dry-run + 结构化 SOUL.md 解析 + 8 个测试通过                                                       |
| P5.4 | 交互式选择器           | 已完成   | `openclaw context-book use` + `setAgentCardDefaultContextBook` + 2 个 CLI 测试通过                                             |

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
- [ ] ~~P4: `cooldown`（待定，需 session 持久化）~~
- [ ] ~~P4: `excludeRecursion`（待定，暂无真实需求）~~
- [x] P5.1: `openclaw assets list` — 列出 workspace 全部资产（三类合并表格）
- [x] P5.1: `openclaw assets validate` — 校验资产 schema 合法性
- [x] P5.1: CLI 注册接线（`register.subclis.ts` + `assets-cli.ts`）
- [x] P5.2: `openclaw assets export <name>` — 导出资产（带 `_meta` 元数据头）
- [x] P5.2: `openclaw assets import <file>` — 导入资产到 workspace
- [x] P5.3: `openclaw assets migrate` — 旧 bootstrap 文件 → Agent Card 自动生成
- [x] P5.4: `openclaw context-book use` — 设置默认 Context Book
- [x] trace-viewer Phase A: `llm_input` hook payload 新增 `assetContext` 字段
- [x] trace-viewer Phase B: collector 消费 `assetContext`，恢复 section 分类，summary 新增 `activeAssets`
- [x] trace-viewer Phase C: viewer 资产面板 + 侧边栏交互 + System Prompt 结构标注 + 列表页标签 + 诊断规则

## 已知问题

- Telegram 群组 policy 是 `allowlist` 但白名单为空（暂不需要群组功能）
- BOOTSTRAP.md 已删除，IDENTITY/SOUL/USER.md 已由"一号"自定义写入
- 旧版“系统提示词压缩”路线已降级为局部子任务，不再作为主线
- 新主线是资产化：Agent Card / Context Book / Prompt Profile
- ~~`loadAgentCardDocument` 返回 `[]` 导致 Agent Card 静默失效~~ → 已修复（3/17，`return []` → `return null`）
- `/context detail` 报告中 Agent Card 替代的文件只显示 name 不显示来源路径，不够直观（低优先级）

## 最新进展（2026-03-19）

### 3/19: 经验触发修复 + E3 hitCount 追踪

- **问题**：天气经验资产被正确创建并注入 prompt，但 deepseek-chat 不遵守（仍询问城市）
- **修复 1 — 注入位置**：经验条目从 `after_context`（中段）改为 `tail_reminder`（尾部提醒），模型遵从度更高
- **修复 2 — 内容格式**：
  - LLM 提取 prompt 新增命令式语气要求（MUST/ALWAYS/NEVER）
  - 内容自动添加 `[经验规则]` 前缀标签
- **修复 3 — E3 hitCount 追踪**：
  - `resolveContextBookPromptContext()` 命中 `source: auto` 条目后，fire-and-forget 更新 `learned.yaml` 的 `hitCount` 和 `lastHitAt`
  - 使用文本正则替换，保留原 YAML 格式和注释
- **已有 learned.yaml 修正**：合并重复的天气条目，改为 tail_reminder + 命令式内容
- 修改文件：`src/agents/context-books.ts`、`src/hooks/bundled/session-memory/experience-extractor.ts`

### 3/19: 第二阶段提示词精简 S1-S4 完成

- **S1: 空文件不注入**
  - `buildBootstrapContextFiles()` 中 `missing: true` 文件不再注入 `[MISSING] Expected at: ...` 标记，直接跳过
  - 修改文件：`src/agents/pi-embedded-helpers/bootstrap.ts`
  - 测试更新：2 个测试改为验证 missing files 被跳过

- **S3: Skill 列表从 XML 压缩为表格**
  - `formatSkillsForPrompt()` 从外部包 XML 格式（每 skill 5 行）改为本地表格格式（每 skill 1 行）
  - 修改文件：`src/agents/skills/workspace.ts`（新增本地 `formatSkillsForPrompt`，不再从 `@mariozechner/pi-coding-agent` 导入）
  - 测试更新：1 个测试改为验证表格格式

- **S4: AGENTS.md 教学内容精简**
  - workspace `~/.openclaw/workspace/AGENTS.md` 从 213 行精简到 ~50 行
  - 删除内容：First Run 段、emoji 标题、人类类比、JSON 示例、心跳教程（82→8 行）、群聊教学（47→5 行）、Memory 教学（28→5 行）、Make It Yours 段
  - 保留内容：Every Session 启动清单、Memory 文件规则、Safety 实操规则、Group Chat 行为规则、Platform formatting、Heartbeat 核心规则

- **S2: 去重合并**
  - S4 精简后重复自然消除：核心区 Safety（抽象原则）vs AGENTS.md Safety（实操规则）不再重叠；Heartbeat、Memory 同理
  - 无需额外代码改动

- **全套测试通过**：921 个文件 / 7599 个测试，0 失败

### 3/19: S5 条件注入替代全量注入

- **AGENTS.md 拆分**：
  - 从 AGENTS.md 移除 Group Chats（5 行）和 Heartbeats（8 行）段落
  - AGENTS.md 从 ~50 行进一步精简到 ~32 行，只保留始终需要的内容（Every Session、Memory、Safety、Tools）
- **新建 `context-books/system-guidance.yaml`**：
  - 群聊行为规则：`chatTypes: ["group"]` + `alwaysActive: true` → 只在群聊时注入
  - 心跳执行规则：`keywords: ["heartbeat", "HEARTBEAT_OK"]` → 只在心跳相关时注入
  - Memory 操作规则：`keywords: ["memory", "记忆", "记住", ...]` → 只在相关话题时注入
  - Cron 使用规则：`keywords: ["cron", "定时", "提醒", ...]` → 只在相关话题时注入
- **资产验证通过**：`openclaw assets validate` 报告 no issues

## 之前进展（2026-03-18）

### 3/18: trace-viewer 资产集成全链路完成（Phase A+B+C + 注入格式修复）

- **Phase A**：`llm_input` hook payload 新增 `assetContext` 字段（`PluginHookAssetContext` 类型）
  - 包含 Agent Card 默认挂载、Context Book 命中/跳过/常驻/at_depth 条目、Prompt Profile 模块/参数/工具范围/输出偏好
  - 只在第一轮 `llm_input` 附带，后续轮次不重复
  - 通过 `resolveAssetContext` 回调从 `systemPromptReport` 构建
- **Phase B**：collector 消费 `assetContext`
  - `LlmInputStep` 保存 `assetContext`
  - `TraceSummary` 新增 `activeAssets` 摘要
  - 恢复 `context-book` / `prompt-profile` section 分类
- **Phase C**：viewer 前端展示
  - `AssetContextPanel` 组件：所有条目可点击展开侧边栏，显示注入位置说明
  - Context Book 预算进度条
  - `PromptStructure` 交叉标注资产来源（Agent Card / CB 标签）
  - 列表页显示 Profile 名称 + CB 命中数
  - 诊断面板新增预算告警规则
- **注入格式修复**：`[Context Book: xxx]` / `[Prompt Profile: xxx]` 改为 `## Context Book: xxx` / `## Prompt Profile: xxx`
  - 原格式用方括号标记，collector 按 `## ` 切块时资产内容被吞进相邻 section
  - 改为 `## ` 标题后，每个资产条目在 System Prompt 结构图中独立可见
  - 106 个相关测试全部通过

### 3/18: P5.3 + P5.4 完成 — 旧 workspace 迁移 + Context Book 选择器

- **`openclaw assets migrate`**：
  - 读取旧 `IDENTITY.md` / `SOUL.md` / `USER.md` 自动生成 `agent-card.yaml`
  - `IDENTITY.md` → `identity` 字段
  - `SOUL.md` → `personality` / `tone` 字段（支持结构化格式解析，否则整体作为 personality）
  - `USER.md` → `user_relationship` 字段
  - `--dry-run` 预览生成内容
  - 已有 Agent Card 时跳过（不覆盖）
  - 旧文件保留不删除
- **`openclaw context-book use <name>`**：
  - 设置 workspace Agent Card 的默认 Context Book（类似 `openclaw profile use`）
  - 新增 `setAgentCardDefaultContextBook()` 和 `resolveContextBookSelection()`
  - 写入 `agent-card.yaml` 的 `default_context_book` 字段
- **CLI 注册**：migrate 加入 assets 子命令，context-book 作为独立 subcli 注册
- **测试覆盖**：migrate 8 个 + context-book CLI 2 个，共 10 个新测试

### 3/18: P5.2 完成 — Export / Import

- **`openclaw assets export <name>`**：
  - 导出任意资产为独立文件，自动追加 `_meta` 元数据头（type/version/exportedAt/sourceAgent）
  - 支持 `--output` 指定输出路径
  - Context Book 数组格式会被包装为 `{ _meta, entries }` 对象
- **`openclaw assets import <file>`**：
  - 导入资产到 workspace，自动识别类型（优先通过 `_meta.type`，否则通过内容字段推断）
  - 导入时剥离 `_meta` 头，只写入纯资产内容
  - 自动创建目标目录（`context-books/` / `prompt-profiles/`）
  - 同名资产已存在时拒绝覆写（`--force` 跳过）
  - 导入后自动运行 validate 并报告 errors/warnings
- **CLI 注册**：export 和 import 已加入 `assets-cli.ts` 注册
- **测试覆盖**：9 个测试（export 3 + import 6）+ CLI 接线 5 个测试，共 14 个新测试

### 3/18: P5.1 完成 — CLI 资产管理基础

- **`openclaw assets list`**：
  - 列出当前 workspace 全部资产（Agent Card + Context Book + Prompt Profile）
  - 合并表格展示：类型 / 名称 / 文件名 / 是否为当前默认
  - 支持 `--type` 过滤、`--json` 输出、`--agent` 指定 agent
  - 从 Agent Card 的 `default_context_book` / `default_prompt_profile` 读取默认状态
- **`openclaw assets validate`**：
  - 校验 workspace 全部资产或指定文件的 schema 合法性
  - Agent Card：检查字段类型、depth_prompt 结构、未知字段警告
  - Context Book：检查条目结构、content 必填、position 枚举、数值字段类型
  - Prompt Profile：检查 temperature/max_tokens/modules/tools/output 类型和结构
  - 支持 `--json` 输出、`--agent` 指定 agent
- **CLI 注册**：遵循 `register.subclis.ts` lazy-loading 模式，`assets-cli.ts` 注册两个子命令
- **测试覆盖**：26 个测试全部通过（`assets.test.ts` + `assets-cli.test.ts`）
- **附带修复**：`RawPromptProfileDocument` 类型缺少 `output` 字段导致的 TS 编译错误

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
