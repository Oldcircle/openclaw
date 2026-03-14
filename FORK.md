# OpenClaw 二次开发状态文件

> 这是 AI 助手和你之间的同步文件。每次开始新的开发任务前，AI 必须读这个文件。

## 基本信息

- **上游仓库**: https://github.com/openclaw/openclaw
- **Fork 地址**: https://github.com/Oldcircle/openclaw
- **本地路径**: `/Users/yb/Opensource/forks/openclaw`
- **二开基础分支**: `dev/main`（所有功能分支从这里切出）
- **上游同步频率**: 每周一次（关注 Release Notes，有 breaking change 重点处理）

## 分支规范

```
upstream/main   →   main（只跟进，禁止直接在此开发）
                        ↓ merge
                  dev/main（二开基础，稳定版本）
                        ↓ 切出
             feat/xxx   fix/xxx   exp/xxx
```

- `main`：只用来同步上游，不写代码
- `dev/main`：所有二开内容合并到这里，也是部署分支
- `feat/功能名`：新功能开发
- `fix/问题名`：修 bug
- `exp/实验名`：实验性改动，不确定要不要合入

## 当前二开方向

<!-- 记录你想改什么，AI 每次都会读这里 -->

- `extensions/trace-viewer`：基于插件系统实现 trace 采集与可视化接口
- `src/agents/pi-embedded-*`：补齐 agentic loop 每轮 `llm_input` / `llm_output` hook，支撑 trace-viewer 看到真实多轮 LLM 过程

当前原则：

- 能用插件解决的，优先放在 `extensions/trace-viewer`
- 只有在现有 hook 粒度不足时，才改核心运行时
- 核心改动必须补测试，并在 `devlog.md` 记录原因

## 当前活跃分支

| 分支       | 功能         | 状态   |
| ---------- | ------------ | ------ |
| `dev/main` | 二开基础分支 | 进行中 |

## 已合入 dev/main 的改动

| 时间 | 内容 | 文件 | 备注 |
| ---- | ---- | ---- | ---- |
| -    | -    | -    | -    |

## 上游同步记录

| 时间       | 同步到上游哪个 commit   | 是否有冲突               |
| ---------- | ----------------------- | ------------------------ |
| 2026-03-13 | f07033ed3 (v2026.3.12+) | 无（AGENTS.md 自动合并） |
| 初始       | 9d941949c               | 无                       |

## 已知与上游的冲突点

_暂无_

## 扩展点说明

OpenClaw 支持 ACP 插件系统（`.acpx`），优先用插件实现功能，避免改核心代码。
插件目录参考：`src/extensions/`

## 环境与运行

```bash
# 启动 Gateway（后台）
nohup pnpm openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &

# 查看日志
tail -f /tmp/openclaw-gateway.log

# 配置工具
pnpm openclaw config set tools.profile full

# 配对 Telegram 用户
pnpm openclaw pairing approve telegram <CODE>
```

## 给 AI 的指令

每次开始工作时，告诉 AI：**"先读 FORK.md 和 devlog.md"**
