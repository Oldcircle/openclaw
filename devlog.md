# OpenClaw 二开流水账

> 按时间倒序记录每次改了什么，为什么改。AI 读这个了解最新进度。

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
