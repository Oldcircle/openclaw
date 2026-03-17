# OpenClaw 二开状态

> AI 每次开始工作前必须读这个文件。完成工作后必须更新。

## 当前进度

| 方向              | 状态   | 说明                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------- |
| trace-viewer 插件 | 进行中 | blob store + collector + API 已落地，3/16 已补 active trace live list/get |
| 核心 LLM hook     | 已完成 | 每轮 `llm_input`/`llm_output` hook，见 devlog 3/14                        |
| 资产化提示词系统  | 进行中 | P1 Context Book 已完成，P2 Agent Card 已通过真实 Gateway 验证             |

## 资产化提示词系统进度

| 阶段 | 内容                   | 状态   | 备注                                                                                                                     |
| ---- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| P0   | 基线与可观测性         | 已完成 | 3/17 通过真实 Gateway `/context detail` 记录基线                                                                         |
| P1   | Context Book 基础版    | 已完成 | 全部 schema 字段已落地，3/17 真实 Gateway 验证通过（常驻注入 + 关键词触发 + tail_reminder + `/context detail` 统计）     |
| P2   | Agent Card 基础版      | 进行中 | 3/17 真实 Gateway 验证通过（persona 替代 + depth_prompt），待补 `default_context_book`/`default_prompt_profile` 自动挂载 |
| P3   | Prompt Profile 基础版  | 未开始 | preset-lite，不开放硬权限提升                                                                                            |
| P4   | 高级预算治理与深度注入 | 未开始 | `at_depth`、更细粒度预算、sticky/cooldown 等高级能力                                                                     |
| P5   | 资产导入导出           | 未开始 | import/export/UI 选择器                                                                                                  |

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
- [ ] P2: 扩展默认挂载资产等能力
- [ ] P3: 待 P2 稳定后进入实现
- [x] trace-viewer: 前端对接 blob API（在 trace-viewer 项目侧）
- [x] trace-viewer: live running trace 通过插件 API 暴露给前端
- [ ] trace-viewer: 用真实 Gateway 再验证 running trace 的列表/详情刷新体验

## 已知问题

- Telegram 群组 policy 是 `allowlist` 但白名单为空（暂不需要群组功能）
- BOOTSTRAP.md 已删除，IDENTITY/SOUL/USER.md 已由"一号"自定义写入
- 旧版“系统提示词压缩”路线已降级为局部子任务，不再作为主线
- 新主线是资产化：Agent Card / Context Book / Prompt Profile
- ~~`loadAgentCardDocument` 返回 `[]` 导致 Agent Card 静默失效~~ → 已修复（3/17，`return []` → `return null`）
- `/context detail` 报告中 Agent Card 替代的文件只显示 name 不显示来源路径，不够直观（低优先级）

## 最新进展（2026-03-17）

### 3/17: 真实 Gateway 端到端验证 + bugfix

- **首次端到端验证**：从 fork 源码启动 Gateway，通过 Telegram 对话和 `/context detail` 验证 P1 + P2 功能
- **P1 Context Book 验证通过**：
  - 常驻条目（`alwaysActive` + `before_context`）正常注入到 bootstrap files
  - 关键词触发条目正常命中
  - `tail_reminder` 条目正常命中
  - `/context detail` 正确显示 Context Book 统计、命中条目、at_depth 概览
- **P2 Agent Card 验证通过**：
  - `agent-card.yaml` 被正确读取，synthetic IDENTITY/SOUL/USER 替代了旧文件（体积和内容均变化）
  - 修改 Agent Card 内容后无需重启 Gateway 即生效（每轮实时读取）
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
- `src/agents/bootstrap-files.ts`
  - 当存在 `Agent Card` 时，对应 persona 槽位会优先使用 synthetic bootstrap 文件；未定义字段仍回退到旧 `SOUL.md / IDENTITY.md / USER.md`
- `src/agents/pi-embedded-runner/run/attempt.ts`
  - `Agent Card depth_prompt` 已接入运行期，与 `Context Book at_depth` 共用同一条历史注入链路
- `src/agents/system-prompt.ts`
  - `Project Context` 中对 `SOUL.md` 的 persona 提示已兼容 synthetic `agent-card.*#SOUL.md` 路径
- 本地验证补充通过：
  - `pnpm exec vitest run src/agents/bootstrap-files.test.ts src/agents/system-prompt.test.ts`
  - `pnpm exec vitest run src/agents/agent-card.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts`

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
