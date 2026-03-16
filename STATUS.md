# OpenClaw 二开状态

> AI 每次开始工作前必须读这个文件。完成工作后必须更新。

## 当前进度

| 方向              | 状态   | 说明                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------- |
| trace-viewer 插件 | 进行中 | blob store + collector + API 已落地，3/16 已补 active trace live list/get |
| 核心 LLM hook     | 已完成 | 每轮 `llm_input`/`llm_output` hook，见 devlog 3/14                        |
| 资产化提示词系统  | 进行中 | `Context Book` P1 已落地多轮迭代，见 `PLAN.md`                            |

## 资产化提示词系统进度

| 阶段 | 内容                   | 状态   | 备注                                                                                                                                                                          |
| ---- | ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | 基线与可观测性         | 未开始 | 优先记录真实 `/context detail` 基线                                                                                                                                           |
| P1   | Context Book 基础版    | 进行中 | 已支持 `alwaysActive`、`keywords`、`secondaryKeywords/secondaryLogic`、位置分层、基础预算、`group/groupWeight/at_depth`，以及 `agentIds/channels/chatTypes/sessionKinds` 过滤 |
| P2   | Agent Card 基础版      | 未开始 | 兼容 `SOUL/IDENTITY/USER`                                                                                                                                                     |
| P3   | Prompt Profile 基础版  | 未开始 | preset-lite，不开放硬权限提升                                                                                                                                                 |
| P4   | 高级预算治理与深度注入 | 未开始 | `at_depth`、更细粒度预算、sticky/cooldown 等高级能力                                                                                                                          |
| P5   | 资产导入导出           | 未开始 | import/export/UI 选择器                                                                                                                                                       |

## 当前待办

- [ ] P0: 记录一次真实 `/context detail` 基线
- [x] P1: 设计 Context Book schema 和最小实现切入点
- [x] P1: 扩展到关键词触发
- [x] P1: 扩展到 `secondaryKeywords/secondaryLogic`
- [x] P1: 扩展到位置分层
- [x] P1: 扩展到基础预算控制
- [x] P1: 扩展到 `agentIds/channels/chatTypes/sessionKinds` 过滤
- [x] P1: 扩展到 `at_depth`
- [ ] 把现有 bootstrap 文件清理项并入 P1 的前置整理
- [ ] 保留工具描述增强 / 尾部提醒作为 P4 的局部先行项
- [ ] P2/P3: 待 P1 稳定后再进入实现
- [x] trace-viewer: 前端对接 blob API（在 trace-viewer 项目侧）
- [x] trace-viewer: live running trace 通过插件 API 暴露给前端
- [ ] trace-viewer: 用真实 Gateway 再验证 running trace 的列表/详情刷新体验

## 已知问题

- Telegram 群组 policy 是 `allowlist` 但白名单为空（暂不需要群组功能）
- BOOTSTRAP.md 已删除，IDENTITY/SOUL/USER.md 已由"一号"自定义写入
- 旧版“系统提示词压缩”路线已降级为局部子任务，不再作为主线
- 新主线是资产化：Agent Card / Context Book / Prompt Profile

## 最新进展（2026-03-16）

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
