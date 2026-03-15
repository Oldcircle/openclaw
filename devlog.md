# OpenClaw 二开流水账

> 按时间倒序记录每次改了什么，为什么改。AI 读这个了解最新进度。

---

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
