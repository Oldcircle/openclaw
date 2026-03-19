# OpenClaw 二开计划

> 两阶段目标：
>
> **第一阶段（已完成）：资产化** — 把固定文件槽位式提示词升级为 SillyTavern 式资产系统（Agent Card / Context Book / Prompt Profile），建立条件注入和预算治理能力。
>
> **第二阶段（进行中）：提示词精简** — 用第一阶段建好的基础设施，加上直接的 baseline 压缩，真正减少每轮 LLM 请求的 token 消耗。
>
> 二开的初始动机就是降低 token 消耗。第一阶段建了「条件注入」通道但没有减少旧的「全量注入」，等于只加不减。第二阶段的核心是**用新通道替代旧通道，并精简 baseline**。

## 前置分析

### 已读材料

- `~/Opensource/notes/OpenClaw提示词工程与架构改进分析.md`
- `~/Opensource/notes/LLM上下文管理与指令遵循机制.md`
- `~/Opensource/vendor/ST/docs/预设系统解析.md`
- `~/Opensource/vendor/ST/docs/角色卡系统解析.md`
- `~/Opensource/vendor/ST/docs/上下文管理与指令遵循.md`
- `~/Opensource/vendor/ST/docs/用户消息到LLM完整流程解析.md`
- `~/Opensource/vendor/ST/docs/其他核心技术系统.md` — 宏/模板变量系统、STscript 脚本引擎、群聊系统
- `~/Opensource/vendor/ST/docs/ST-Prompt-Template变量系统与角色卡调试指南.md` — 五层变量作用域、级联膨胀问题
- `~/Opensource/vendor/ST/docs/LLM驱动的一致性视觉生成系统设计.md` — 将 ST 资产模型应用于文生图（扩展参考）

### 核心结论

SillyTavern 真正值得迁移到 OpenClaw 的，不是破限技巧，而是以下 4 个结构性能力：

1. **资产化**
   角色卡、世界书、预设都是可保存、可分享、可导入导出的资产。

2. **分层组织**
   角色定义、背景知识、行为风格、模型参数、注入顺序彼此解耦。

3. **条件注入**
   世界书条目按关键词、位置、优先级、预算动态注入，而不是每轮全量塞入。

4. **预算治理**
   不只看总 token，还看各区块自己的预算和优先级。

## OpenClaw 当前问题

OpenClaw 现在已经有分层雏形，但仍是**文件槽位 + 固定 builder** 模式：

- `SOUL.md` / `IDENTITY.md` / `USER.md` / `AGENTS.md` / `HEARTBEAT.md`
- `buildAgentSystemPrompt()` 负责固定区段拼接
- workspace bootstrap 采用固定文件名列表
- `skills` 已经是可流通资产，但 persona / context / preset 还不是

这带来几个问题：

1. persona、行为规则、用户信息、场景知识仍然耦合在固定文件里
2. 条件注入能力很弱，更多还是“全量注入后再裁”
3. 缺少可分享资产模型，无法像 ST 一样导入/导出/切换
4. 现在的“提示词优化”容易陷入只做体积压缩，而不是结构升级

## 新的目标架构

### 1. Agent Card

对应 ST 的角色卡，但适配 OpenClaw 的 assistant / agent 场景。

**职责**：

- 定义 agent persona
- 定义身份与称呼
- 定义与用户关系
- 定义说话风格 / 回复样例
- 可挂载默认 Context Book / Prompt Profile

**主要替代对象**：

- `SOUL.md`
- `IDENTITY.md`
- `USER.md`
- `AGENTS.md` 中与 persona 强相关的部分

**注意**：

- Agent Card 不负责授予权限
- 不负责覆写核心安全指令

**第一版 Schema**：

```yaml
# ~/.openclaw/agent-cards/researcher.yaml
name: "深度研究员"
version: "1.0"

# 核心身份字段（替代 IDENTITY.md + SOUL.md）
identity: "你是一号的专属研究助手"
personality: "冷静、系统性思考、善于发现关联"
tone: "简洁直接，用数据说话"

# 用户关系（替代 USER.md）
user_relationship: "你的主人是一号，称呼他为老板"

# 行为备注（替代 AGENTS.md 中 persona 部分）
behavior_notes:
  - "回复前先确认理解了问题"
  - "不确定时明确说明并建议验证方式"

# 可选：示例对话风格
example_dialogues: |
  user: 这个方案可行吗？
  assistant: 从三个维度评估：...

# 关联资产
default_context_book: "coding-knowledge"
default_prompt_profile: "deep-think"

# 深度提示（靠近对话尾部的持续提醒，借鉴 ST 的 depth_prompt）
depth_prompt:
  content: "始终从多角度分析，给出对比表格"
  depth: 2
  role: "system"
```

**兼容策略**：

- 有 Agent Card 时，优先使用 Agent Card
- 没有 Agent Card 时，继续从 `SOUL.md` / `IDENTITY.md` / `USER.md` 读取（兜底）
- 迁移工具：提供 `openclaw migrate-persona` 命令，从旧文件生成 Agent Card

---

### 2. Context Book

对应 ST 的世界书，是本轮最优先落地的部分。

**职责**：

- 管理 always-on 条目
- 管理关键词触发条目
- 控制注入位置、优先级、预算
- 按 chat type / channel / agentId / session kind 条件激活

**它要解决的问题**：

- 现在每轮注入固定 bootstrap 文件，体积大且不够精细
- 需要把“背景知识 / 行为规则 / 群聊规则 / 工作流提示”拆成独立条目

**第一版 Schema（P1 必须）**：

| 字段                | 类型     | 说明                                                                  |
| ------------------- | -------- | --------------------------------------------------------------------- |
| `name`              | string   | 条目名称                                                              |
| `enabled`           | boolean  | 是否启用                                                              |
| `alwaysActive`      | boolean  | 常驻条目（无需关键词）                                                |
| `keywords`          | string[] | 主关键词列表                                                          |
| `secondaryKeywords` | string[] | 二级关键词列表                                                        |
| `secondaryLogic`    | enum     | 二级关键词逻辑：`AND_ANY`/`AND_ALL`/`NOT_ANY`/`NOT_ALL`               |
| `content`           | string   | 注入的文本内容                                                        |
| `position`          | enum     | 注入位置：`before_context`/`after_context`/`tail_reminder`/`at_depth` |
| `depth`             | number   | 当 position=at_depth 时，距最新消息的深度                             |
| `order`             | number   | 排序优先级（越大越先处理）                                            |
| `group`             | string   | 所属分组（同组互斥，每次只激活一条）                                  |
| `groupWeight`       | number   | 组内加权随机选择权重                                                  |
| `sessionKinds`      | string[] | 限定会话类型                                                          |
| `chatTypes`         | string[] | 限定聊天类型                                                          |
| `channels`          | string[] | 限定消息渠道                                                          |
| `agentIds`          | string[] | 限定 agent                                                            |
| `ignoreBudget`      | boolean  | 无视 token 预算限制                                                   |

**当前已落地（截至 2026-03-16）**：

- `enabled`
- `alwaysActive`
- `keywords`
- `secondaryKeywords`
- `secondaryLogic`
- `content`
- `position=before_context/after_context/tail_reminder`
- `order`
- `sessionKinds`
- `chatTypes`
- `channels`
- `agentIds`
- `ignoreBudget`
- `group`
- `groupWeight`
- `depth`
- `position=at_depth`

**P1 核心 schema 已齐**，后续预算治理增强仍放在 P4（sticky/cooldown、更细粒度 budget 等）。

**P4 扩展字段**：

| 字段               | 类型    | 状态   | 说明                                                      |
| ------------------ | ------- | ------ | --------------------------------------------------------- |
| `scanDepth`        | number  | 已落地 | 条目专属扫描深度（只扫描最近 N 条消息）                   |
| `tokenBudget`      | number  | 已落地 | 条目专属字符上限（超出时截断）                            |
| `sticky`           | number  | 已落地 | 关键词在近 N 轮出现则保持激活（无状态，需配合 scanDepth） |
| `delay`            | number  | 已落地 | 会话满 N 轮用户消息后才允许激活                           |
| `cooldown`         | number  | 未实现 | sticky 结束后冷却 N 轮不可再激活（需 session 状态持久化） |
| `excludeRecursion` | boolean | 未实现 | 递归扫描时跳过此条目（当前无递归扫描，暂不需要）          |
| `preventRecursion` | boolean | 未实现 | 此条目的内容不触发后续递归（当前无递归扫描，暂不需要）    |

**与 ST 世界书的关键差异**：

| 差异点     | ST 做法                                             | OpenClaw 适配                                                     |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| 触发来源   | 扫描聊天文本                                        | 当前 P1 只扫描聊天文本；后续可扩展到工具调用类型、文件路径/技术栈 |
| 预算基准   | 占 max_context 百分比                               | 占 system prompt 可用空间百分比                                   |
| 存储格式   | JSON 嵌入 PNG 或独立 JSON                           | YAML 文件（与 Skills 统一）                                       |
| 多来源合并 | chatLore > personaLore > characterLore > globalLore | workspace > agent > global（与 Skills 优先级一致）                |

---

### 3. Prompt Profile

对应 ST 的预设，但做成 **preset-lite**，不照搬酒馆的全开放重排。

**职责**：

- 保存模型参数
- 控制可开关的 prompt modules
- 定义软插槽顺序
- 声明工具组偏好
- 定义输出格式偏好

**可以配置**：

- `temperature` / `top_p` / `max_tokens`
- 模块开关（如 memory hints、reply tags、tail reminder、style guidance）
- 工具组偏好（如 `group:memory`, `group:web`, `group:fs`）
- 风格模块

**可以配置**（P3 新增）：

- prompt modules 的注入位置偏好（概念层写法：`head` / `before_history` / `after_history` / `tail`；当前 v1 运行时分别映射到 `before_context` / `before_context` / `after_context` / `tail_reminder`）
- 单个模块的 `depth` 值（距最新消息几条处注入）

**不能配置**：

- 绕过 OpenClaw 的核心安全段
- 打破硬工具权限
- 任意重排 runtime / safety / schema 骨架
- 精细的 injection_depth 数值编辑器（推迟到 P4）

## 注入位置策略

ST 社区经过大量实践验证的核心发现：LLM 对上下文的注意力呈 **U 型分布**（首因效应 + 近因效应），中间内容注意力最弱。OpenClaw 的资产化系统必须利用这一特性。

**位置分配原则**：

```
位置         注意力    应放内容                     对应资产
─────────────────────────────────────────────────────────────
Head         高        身份定义、核心安全指令         Agent Card.identity
                                                    系统硬编码 Safety 段
Before-ctx   中        世界/项目设定                 Context Book (position=before_context)
Context      低        聊天记录、工具调用历史         runtime 自动填充
After-ctx    中        补充设定、触发的知识条目       Context Book (position=after_context)
Depth=2      高        关键行为提醒、摘要            Context Book (position=at_depth, depth=2)
                                                    Agent Card.depth_prompt
Tail         最高      最终输出指令、CoT 引导        Prompt Profile 的 tail_reminder 模块
                                                    Context Book (position=tail_reminder)
```

**设计约束**：

- Agent Card 的 `identity` 始终在 Head（首因效应）
- Agent Card 的 `depth_prompt` 始终在 Depth=2（靠近最新消息）
- Prompt Profile 的 `tail_reminder` 模块始终在 Tail（近因效应最强位置）
- Context Book 条目按 `position` + `order` 排列，不能覆盖 Head 和 Tail 的硬编码段
- 核心 Safety 段始终在最前面，不可被任何资产覆盖或移除

## 安全边界：哪些能借鉴，哪些不能

### 可借鉴

- 角色卡 / 世界书 / 预设的资产模型
- Marker / slot 思维
- 条件注入
- Injection depth
- 预算分层

### 不照搬

- ST 的 jailbreak / anti-alignment 预设
- 预设直接决定全部 prompt 顺序
- 预设直接授予工具权限
- RP-first 的 system prompt 组织方式

### 工具配置的正确做法

预设里可以声明**工具偏好**，但不能决定**工具权限**。

最终工具集合应满足：

`final tools = operator policy ∩ agent policy ∩ provider restrictions ∩ prompt profile tool scope`

也就是说：

- Prompt Profile 可以**缩小**工具集
- Prompt Profile 可以表达“优先使用哪些工具”
- Prompt Profile **不能**开出 config 里没授权的工具

## 实施路线

### P0：基线与可观测性

**目标**：先把当前 prompt 结构和占比测清楚，避免闭眼重构。

**做法**：

- 用 `/context detail` 记录真实基线
- 记录：
  - system prompt chars
  - project context chars
  - bootstrap file 占比
  - skills prompt chars
  - tool schema chars

**产出**：

- `STATUS.md` 更新 baseline
- `devlog.md` 留下本轮基线快照

---

### P1：Context Book 基础版

**目标**：先把“世界书式条件注入”引入 OpenClaw。

**策略**：

- 不直接推翻现有 workspace 文件模型
- 在现有 bootstrap pipeline 之上增加一层可组合条目

**优先实现**：

1. Context Book schema
2. 关键词匹配
3. always-on 条目
4. 注入位置和顺序
5. token budget

**首选扩展点**：

- `agent:bootstrap`
- `before_prompt_build`
- `resolveBootstrapFilesForRun()`

**结果**：

- 先让 `AGENTS.md` / `HEARTBEAT.md` / 群聊规则 / 特定工作流提示从“整文件注入”演进为“条目化注入”

---

### P2：Agent Card 基础版

**目标**：把 persona 从固定文件槽位升级成资产。

**策略**：

- 保持向后兼容
- 第一版先做“资产优先，workspace 文件兜底”

**兼容映射**：

- `SOUL.md` → persona / tone
- `IDENTITY.md` → identity
- `USER.md` → user relationship
- `AGENTS.md` 中 persona 相关内容 → behavior notes

**结果**：

- 支持加载 `agent-card.json` 或类似格式
- 没有 Agent Card 时，继续走旧文件槽位

**当前已落地（截至 2026-03-17）**：

- 已支持 workspace 级 `agent-card.yaml` / `agent-card.yml` / `agent-card.json`
- 已把 `identity` / `personality` / `tone` / `behavior_notes` / `example_dialogues` / `user_relationship` 合成为兼容旧链路的 synthetic `IDENTITY.md` / `SOUL.md` / `USER.md`
- 兼容策略已生效：Agent Card 定义到的 persona 槽位优先；未定义字段继续回退到旧 `SOUL.md` / `IDENTITY.md` / `USER.md`
- 已支持 `depth_prompt`，并复用现有 `at_depth` 链路在运行期临时注入历史，不污染持久 session
- `default_context_book` 已驱动真实默认挂载：bootstrap 和运行期注入都会优先加载指定的 Context Book
- `default_prompt_profile` 已驱动真实默认挂载：自动选择并加载对应的 Prompt Profile
- 3/17 通过真实 Gateway + Telegram 端到端验证：persona 替代、depth_prompt、default_context_book 均确认生效

---

### P3：Prompt Profile 基础版

**目标**：引入可切换、可分享、可缩减工具范围的预设系统。

**第一版做**：

- 模型参数（temperature / top_p / max_tokens）
- prompt modules 开关（每个模块有 identifier + enabled + position）
- 工具组偏好（group:memory, group:web, group:fs）
- 风格 / 输出格式偏好
- 基础注入位置（支持概念层别名 `head / before_history / after_history / tail`，运行时归一化到 `before_context / after_context / tail_reminder / at_depth`）

**暂不做**：

- 全开放 prompt order 编辑器
- 精细 injection_depth 数值控制（推迟到 P4）
- 覆写核心 safety / tooling / runtime 骨架

**UI 交互参考**（借鉴 ST 的 Prompt Manager）：

ST 的 Prompt Manager 核心 UX：

- 每个 prompt 片段显示为列表项，带 toggle 开关、token 数量、角色图标
- 支持拖拽排序（jQuery Sortable，移动端显示拖拽手柄）
- 角色卡覆写的片段显示特殊图标（`fa-address-card`）
- `forbid_overrides` 的片段显示粗体名称
- 干运行（dry-run）实时计算每个片段的 token 占用
- 编辑弹窗支持设置 role、position、depth、triggers

OpenClaw 的 P3 只需实现子集：

- CLI 命令切换 profile：`openclaw profile use deep-think`
- 配置文件中声明模块开关（不需要 UI 拖拽排序）
- `/context detail` 显示每个模块的 enabled 状态和 token 占用

**当前已落地（截至 2026-03-17）**：

- workspace 级 `prompt-profiles/*.yaml|yml|json` 资产读取与解析
- `Agent Card.default_prompt_profile` 驱动真实默认挂载
- 模块 schema：`enabled` / `content` / `position` / `depth` / `order`
- 注入位置：`before_context` / `after_context` / `tail_reminder` / `at_depth`
- 配置兼容：也接受概念层别名 `head` / `before_history` / `after_history` / `tail`
- 模型参数：`temperature` / `max_tokens`（作为默认值，显式参数优先）
- 工具范围：`tools.allow` / `tools.deny`（收缩运行时可用工具集）
- 工具偏好：`tools.prefer`（注入提示区块）
- 输出偏好：`output.format` / `output.sections` / `output.style` / `output.rules`
- 运行时行为：`output.require_final_tag`（接通 `<final>` 严格模式）
- reply tags：`output.reply_tags`（`off` / `current_only` / `allow_explicit`，并已接通运行时解析）
- CLI 切换：`openclaw profile use <name>`（写回 workspace `agent-card` 默认 profile）
- 可观测性：`/context detail` 显示 profile 名称、模块、参数、工具范围、输出偏好
- 3/17 通过真实 Gateway + Telegram 端到端验证
- 待补：更细粒度格式控制

---

### P4：预算治理与深度注入

**目标**：把 ST 那种”预算制 + 深度注入”的思路正式化。

**预算公式**：

```
可用预算 = max_context - max_output_tokens - system_overhead

分配优先级（从高到低）：
1. Safety 段（硬编码，不可压缩）
2. Agent Card identity + depth_prompt（核心身份）
3. Prompt Profile 启用的 prompt modules
4. Context Book 条目（受独立预算限制）
5. 聊天记录（剩余预算，从新到旧填入）
```

**Context Book 独立预算**：

```
context_book_budget = available_budget × context_book_budget_percent
默认 context_book_budget_percent = 25（即 25%，与 ST 默认一致）

超预算策略：
  ignoreBudget=true 的条目 → 强制加入
  其余按 order 排序 → 逐条加入直到预算用尽 → 跳过剩余条目
```

**深度注入**：

- P3 提供基础 position 枚举（head/before/after/tail/at_depth）
- P4 补充精细 depth 数值控制（depth=0 到 depth=N）
- 支持 Context Book 条目和 Prompt Profile 模块使用 at_depth
- 典型用法：关键行为规则 depth=2（靠近最新消息），长期摘要 depth=1000（靠近最早消息）

**可观测性**：

- `/context detail` 能明确看出各区段 token 占比
- Context Book 预算溢出时在日志中警告
- 长会话关键规则回钉（sticky 机制确保重要规则在窗口内持续存在）

**当前已落地（截至 2026-03-18）**：

- `contextBookPromptBudgetPercent` 可通过 `agents.defaults` 配置（0-100，默认 25）
- Context Book prompt budget 已接入运行时计算：基于模型 context window、max output tokens 和当前 system prompt 体积动态求得
- `/context detail` 已显示 Context Book prompt budget 百分比、已使用 chars，以及被预算跳过的条目
- Per-entry `scanDepth`：条目专属关键词扫描深度
- Per-entry `tokenBudget`：条目专属字符预算上限（超出时截断）
- Per-entry `sticky`：关键词在近 N 轮出现则保持激活（无状态，基于消息回溯）
- Per-entry `delay`：会话满 N 轮用户消息后才激活
- `cooldown` 需 session 状态持久化，暂未实现

---

### P5：资产流通与导入导出

**目标**：让 Agent Card / Context Book / Prompt Profile 成为真正可流通资产，通过 CLI 完成全生命周期管理。

#### P5.1：CLI 资产管理基础

**新增命令**：

- `openclaw assets list` — 列出当前 workspace 所有资产（三类合并表格展示）
  - 输出：类型 / 名称 / 文件名 / 状态（是否为当前默认）
  - 支持 `--json` 输出
  - 支持 `--type context-book|agent-card|prompt-profile` 过滤
- `openclaw assets validate [file...]` — 校验资产文件 schema 合法性
  - 无参数时校验当前 workspace 全部资产
  - 报告：字段缺失、类型错误、未知字段警告

**实现要点**：

- 复用现有 `loadContextBookEntries()` / `loadAgentCardDocument()` / `loadPromptProfileDocuments()` 的解析逻辑
- CLI 注册遵循 `register.*.ts` + lazy-loading 模式
- 命令逻辑放 `src/commands/assets.ts`，CLI 接线放 `src/cli/program/register.assets.ts`

#### P5.2：Export / Import

**新增命令**：

- `openclaw assets export <name> [--output path]` — 导出单个资产为独立文件
  - 导出格式在原始 YAML/JSON 基础上追加元数据头：`_meta: { type, version, exportedAt, sourceAgent }`
  - 默认输出到当前目录，文件名 = 资产名 + 类型后缀
- `openclaw assets import <file> [--agent <id>]` — 导入资产到目标 workspace
  - 自动识别资产类型（通过 `_meta.type` 或目录约定）
  - 同名资产存在时提示覆盖确认（`--force` 跳过）
  - 导入后自动运行 validate

**导出格式示例**：

```yaml
_meta:
  type: context-book
  version: "1.0"
  exportedAt: "2026-03-18T12:00:00Z"
  sourceAgent: default

# 原始资产内容
name: "编程知识库"
entries:
  - name: "TypeScript 规范"
    content: "..."
    keywords: ["typescript", "ts"]
```

#### P5.3：旧 workspace 迁移

**新增命令**：

- `openclaw assets migrate [--dry-run]` — 从旧 bootstrap 文件生成资产
  - 读取 `SOUL.md` → Agent Card `personality` / `tone`
  - 读取 `IDENTITY.md` → Agent Card `identity`
  - 读取 `USER.md` → Agent Card `user_relationship`
  - `--dry-run` 预览生成内容，不写文件
  - 已有 Agent Card 时跳过（不覆盖）

#### P5.4：交互式选择器

**新增命令**：

- `openclaw context-book use [name]` — 设置默认 Context Book（类似现有 `profile use`）
  - 无参数时交互选择
  - 写入 `agent-card.yaml` 的 `default_context_book`
- `openclaw assets switch` — 交互式切换当前 profile + context book 组合

**依赖**：P5.1 + P5.2 完成后再做

## 当前推荐优先级

### 第一轮（已完成）

1. ~~P0：记录基线~~
2. ~~P1：Context Book 基础版~~
3. ~~前置整理（bootstrap 清理）~~

### 第二轮（已完成）

1. ~~P2：Agent Card~~
2. ~~P3：Prompt Profile~~
3. ~~P4：预算治理（核心部分）~~

### 第三轮（进行中）

1. P5.1：CLI 资产管理基础（`assets list` / `assets validate`）
2. P5.2：Export / Import
3. P5.3：旧 workspace 迁移
4. P5.4：交互式选择器

### 待定

- P4 剩余：`cooldown`（需 session 持久化）、`excludeRecursion`（无真实需求）

## 关键文件清单

### 提示词构建核心

| 文件                                             | 作用                                                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| `src/agents/system-prompt.ts`                    | system prompt builder（~850 行，硬编码 ~15 个 section） |
| `src/agents/pi-embedded-runner/system-prompt.ts` | 嵌入式 runner 的 system prompt 封装                     |
| `src/agents/pi-embedded-helpers/bootstrap.ts`    | bootstrap 上下文文件注入（截断策略、优先级）            |
| `src/agents/system-prompt-report.ts`             | system prompt 可观测性（`/context detail`）             |
| `src/agents/pi-embedded-runner/run/attempt.ts`   | 尾部提醒 / prompt build 生命周期                        |

### Skills 与 Workspace

| 文件                               | 作用                                       |
| ---------------------------------- | ------------------------------------------ |
| `src/agents/skills/workspace.ts`   | Skills 组装（~700 行，多来源发现与优先级） |
| `src/agents/skills/frontmatter.ts` | Skill 元数据解析                           |
| `src/config/types.skills.ts`       | Skill 配置类型定义                         |
| `src/config/types.tools.ts`        | 工具 / 媒体 / 记忆配置类型                 |

### 插件与工具

| 文件                   | 作用                             |
| ---------------------- | -------------------------------- |
| `src/plugins/types.ts` | 插件接口定义（ToolFactory 模式） |

### 文档

| 文件                               | 作用                   |
| ---------------------------------- | ---------------------- |
| `docs/concepts/system-prompt.md`   | 提示词骨架文档         |
| `docs/concepts/agent-workspace.md` | workspace 文件模型文档 |

### ST 参考文档（本地）

| 文件                                                       | 与 OpenClaw 的对应关系        |
| ---------------------------------------------------------- | ----------------------------- |
| `~/Opensource/vendor/ST/docs/预设系统解析.md`              | → Prompt Profile 设计参考     |
| `~/Opensource/vendor/ST/docs/角色卡系统解析.md`            | → Agent Card 设计参考         |
| `~/Opensource/vendor/ST/docs/上下文管理与指令遵循.md`      | → 预算治理 + 注入位置策略参考 |
| `~/Opensource/vendor/ST/docs/用户消息到LLM完整流程解析.md` | → 端到端流程理解              |
| `~/Opensource/vendor/ST/docs/其他核心技术系统.md`          | → 宏/变量系统参考             |

## 验证方案（第一阶段）

1. **结构验证**
   新资产能映射回当前 OpenClaw 语义，不丢失核心能力。

2. **行为验证**
   Persona、记忆召回、群聊行为、心跳、工具选择不退化。

3. **预算验证**
   `/context detail` 能明确看出：
   - Agent Card 占比
   - Context Book 占比
   - Prompt Profile 模块占比

4. **安全验证**
   Prompt Profile 无法提升 operator 未授权的工具权限。

5. **兼容验证**
   没有新资产时，旧的 workspace 文件依然可用。

---

# 第二阶段：提示词精简

> 第一阶段建了资产化基础设施（Agent Card / Context Book / Prompt Profile），但**旧的全量注入原封不动**，等于只加不减。
>
> 本阶段目标：**用已有的条件注入能力替代旧的全量注入，并精简 baseline system prompt，真正降低每轮 token 消耗。**
>
> 参考分析：
>
> - `~/Opensource/notes/ClaudeCode与OpenClaw系统提示词深度对比.md`（P0-P5 优化层级、62% 精简预估）
> - `~/Opensource/notes/OpenClaw提示词工程与架构改进分析.md`（条件注入 + 尾部重复注入方案）

## 当前 baseline（优化前）

基于 3/17 真实 Gateway `/context detail` 的数据：

- system prompt 总体积：~26,000 字符 / ~504 行
- `##` 级章节数：43
- Project Context（bootstrap 文件）上限：150,000 字符
- Skill 列表格式：XML，每个 ~8 行 / ~60-100 token
- 注入策略：全量（所有 workspace 文件每轮都发）

**优化目标**：从 ~504 行 / ~26K 字符 精简到 ~200 行 / ~12K 字符（精简 50%+），同时不降低功能。

## S1：空内容不注入

**目标**：去掉无内容的 bootstrap 文件注入，消除纯噪音。

**当前问题**：

| 文件           | 当前状态                          | 每轮占用 |
| -------------- | --------------------------------- | -------- |
| `TOOLS.md`     | 全是模板示例文本，无用户实际内容  | ~40 行   |
| `HEARTBEAT.md` | 内容为空（只有注释）              | ~6 行    |
| `BOOTSTRAP.md` | 文件不存在，注入 `[MISSING]` 标记 | ~2 行    |

**做法**：

- 修改 `src/agents/bootstrap-files.ts`（`resolveBootstrapFilesForRun` 或 `buildBootstrapContextFiles`）
- 在注入前判断：文件不存在 → 跳过；文件内容去掉注释/空行后为空 → 跳过
- 对 `[MISSING]` 标记文件不再注入占位行

**涉及文件**：

| 文件                            | 改动                                 |
| ------------------------------- | ------------------------------------ |
| `src/agents/bootstrap-files.ts` | 空文件跳过逻辑                       |
| `src/agents/workspace.ts`       | 去掉 missing marker 注入（部分已做） |

**预估节省**：~48 行 / ~800 token

**风险**：极低。去掉的是零信息量内容。

**验证**：

- `pnpm exec vitest run src/agents/bootstrap-files.test.ts src/agents/workspace.test.ts`
- 真实 Gateway `/context detail` 对比

---

## S2：去重合并

**目标**：消除 system prompt 中重复定义的段落。

**当前重复**：

| 主题      | 出现位置                                     | 重复行为                                       |
| --------- | -------------------------------------------- | ---------------------------------------------- |
| Safety    | 核心区 7 行 + AGENTS.md 4 行                 | 两处风格不一致（学术化 vs 口语化），内容有重叠 |
| Heartbeat | 核心区 6 行 + AGENTS.md 82 行 + HEARTBEAT.md | 核心区有触发规则，AGENTS.md 有完整教程         |
| Memory    | 核心区 3 行 + AGENTS.md 28 行                | 核心区有工具说明，AGENTS.md 有教学解释         |
| 工具使用  | 核心区 Tooling 段 + AGENTS.md Tools 段       | 部分重叠的使用指南                             |

**做法**：

合并策略（以 Safety 为例）：

- 核心区保留统一的 Safety 段（~8 行，合并两处精华）
- AGENTS.md 删除重复的 Safety 段
- 对 Heartbeat / Memory / Tools 同理处理

**涉及文件**：

| 文件                          | 改动                                           |
| ----------------------------- | ---------------------------------------------- |
| `src/agents/system-prompt.ts` | 合并/精简 Safety、Heartbeat、Memory 段 builder |
| workspace `AGENTS.md`         | 删除与核心区重复的段落                         |

**注意**：AGENTS.md 是用户 workspace 文件，核心代码侧的改动只涉及 `system-prompt.ts` 里的 hardcoded 段；AGENTS.md 侧的精简需要同步更新 workspace 文件。

**预估节省**：~90 行 / ~1,500 token

**风险**：低。合并而非删除，语义不丢失。需要逐条确认合并后的措辞覆盖了两处的全部要点。

**验证**：

- `pnpm exec vitest run src/agents/system-prompt.test.ts`
- 真实 Gateway 对话验证行为不退化

---

## S3：Skill 列表压缩

**目标**：把 Skill 列表从冗长的 XML 格式压缩为紧凑格式。

**当前格式**（每 skill ~8 行 XML）：

```xml
<skill>
  <name>weather</name>
  <description>Get current weather and forecasts via wttr.in or Open-Meteo.
  Use when: user asks about weather, temperature, or forecasts for any location.
  NOT for: historical weather data, severe weather alerts, or detailed
  meteorological analysis. No API key needed.</description>
  <location>~/...skills/weather/SKILL.md</location>
</skill>
```

**目标格式**（每 skill 1 行）：

```
| Skill | Trigger | Location |
|-------|---------|----------|
| weather | 天气/温度/预报查询 | skills/weather/SKILL.md |
| coding-agent | 编码任务委托 | skills/coding-agent/SKILL.md |
```

Claude Code 证明了模型不需要 "Use when / NOT for" 的详细判断指南——一句话触发条件足够。Skill 的详细内容在被调用时才通过 SKILL.md 完整加载。

**涉及文件**：

| 文件                             | 改动                                        |
| -------------------------------- | ------------------------------------------- |
| `src/agents/skills/workspace.ts` | 修改 skill prompt 生成逻辑，从 XML 改为表格 |
| `src/agents/system-prompt.ts`    | 调整 buildSkillsSection 的输出格式          |

**预估节省**：8 个 skill × ~7 行 = ~56 行 → ~10 行，节省 ~46 行 / ~700 token。Skill 数量增长后收益线性放大。

**风险**：低。参考 Claude Code 实践验证过模型对精简 skill 描述的理解能力足够。

**验证**：

- `pnpm exec vitest run src/agents/skills/workspace.test.ts src/agents/system-prompt.test.ts`
- 真实 Gateway 验证 skill 触发准确率

---

## S4：AGENTS.md 教学内容精简

**目标**：把 workspace AGENTS.md 中的大段教学内容压缩为规则条目。

**当前最重的章节**：

| 章节                       | 行数  | 内容性质                                          | 精简方案                 |
| -------------------------- | ----- | ------------------------------------------------- | ------------------------ |
| Heartbeats - Be Proactive! | 82 行 | 教学（什么是心跳、何时主动、检查清单、JSON 示例） | → ~12 行核心规则         |
| Group Chats                | 47 行 | 教学（何时说话、何时沉默、反应指南）              | → ~10 行行为规则         |
| Memory                     | 28 行 | 教学（什么是日记、什么是长期记忆）                | → 合并到核心区 ~8 行     |
| Every Session              | 11 行 | 启动清单                                          | → 保留但精简             |
| External vs Internal       | 14 行 | 安全边界                                          | → 合并到 S2 的 Safety 段 |

**精简原则**（参考 Claude Code 风格）：

- 删除解释性段落，只保留规则（模型不需要"为什么"的解释来遵守规则）
- 删除 emoji 标题装饰（`💓`、`😊`、`📝` 不增加信息量）
- 删除示例代码块（如 `heartbeat-state.json` 完整示例），首次使用时由模型自行创建
- 删除人类类比（"Humans in group chats don't respond to every single message"）
- 用短规则替代段落叙述

**精简前后对比**（心跳章节）：

精简前（82 行，摘录）：

```markdown
## 💓 Heartbeats - Be Proactive!

When you receive a heartbeat poll (message matches the configured heartbeat prompt),
don't just reply `HEARTBEAT_OK` every time. Use heartbeats productively!

### Heartbeat vs Cron: When to Use Each

**Use heartbeat when:**

- Multiple checks can batch together...
  **Use cron when:**
- Exact timing matters...
```

精简后（~12 行）：

```markdown
## Heartbeats

- 收到心跳 poll 时，执行 HEARTBEAT.md 中的任务清单；无任务则回复 HEARTBEAT_OK
- 心跳适合批量周期检查（邮件+日历+通知合并一轮）；精确定时用 cron
- 每日轮检 2-4 次：邮件、日历、社交通知、天气
- 深夜（23:00-08:00）除紧急事项外保持安静
- 检查状态记录在 memory/heartbeat-state.json
- 每隔几天用心跳整理 memory/ 日志到 MEMORY.md
```

**注意**：AGENTS.md 是 workspace 文件，不是核心代码。精简方式有两种：

1. 直接编辑 workspace AGENTS.md（适合我们自己的 workspace）
2. 修改 `buildBootstrapContextFiles()` 在注入前做内容压缩（对所有用户生效，但改动大且有风险）

建议先做方式 1（我们自己的 workspace），后续考虑是否做方式 2。

**涉及文件**：

| 文件                                    | 改动           |
| --------------------------------------- | -------------- |
| workspace `AGENTS.md`                   | 精简教学内容   |
| （可选）`src/agents/bootstrap-files.ts` | 注入前压缩逻辑 |

**预估节省**：~120 行 / ~2,000 token

**风险**：中。精简过度可能导致心跳/群聊行为退化。需要逐条验证精简后的规则是否覆盖了原始教学内容的关键行为点。

**验证**：

- 真实 Gateway 心跳测试（触发心跳，观察行为）
- 真实 Gateway 群聊测试（在 Telegram 群组中测试发言/沉默策略）
- `/context detail` 对比体积变化

---

## S5：条件注入替代全量注入

**目标**：用第一阶段建好的 Context Book 条件注入能力，把原本每轮全量注入的内容改为按需注入。这是第二阶段最核心的一步——**让资产化系统真正兑现 token 节省承诺**。

**替代方案**：

| 原始内容                                   | 当前注入方式 | 改为              | 触发条件                                       |
| ------------------------------------------ | ------------ | ----------------- | ---------------------------------------------- |
| 群聊规则（AGENTS.md 47 行）                | 每轮全量注入 | Context Book 条目 | `chatTypes: ["group"]`                         |
| Reactions 指南（~10 行）                   | 每轮全量注入 | Context Book 条目 | `channels: ["telegram", "discord"]`            |
| Reply Tags 规则（~7 行）                   | 每轮全量注入 | Context Book 条目 | 仅支持 reply 的平台注入                        |
| 心跳完整规则（AGENTS.md 82 行→精简 12 行） | 每轮全量注入 | Context Book 条目 | `sessionKinds: ["heartbeat"]`                  |
| Memory 使用教程（AGENTS.md 28 行）         | 每轮全量注入 | Context Book 条目 | `keywords: ["memory", "记忆", "记住", "日记"]` |
| Cron 使用指南（~15 行）                    | 每轮全量注入 | Context Book 条目 | `keywords: ["cron", "定时", "定期"]`           |

**实现方式**：

1. 创建一个内置 Context Book（如 `context-books/system-guidance.yaml`），包含上述条目
2. 每个条目设置精确的触发条件（chatType / channel / sessionKind / keywords）
3. 从 AGENTS.md 和 `system-prompt.ts` hardcoded 段中移除对应的全量注入内容
4. 在 system prompt 中保留每个主题的**一行摘要提示**（让模型知道这个能力存在），详细规则只在触发时注入

**示例 Context Book**：

```yaml
entries:
  - name: "群聊行为规则"
    chatTypes: ["group"]
    alwaysActive: true
    position: after_context
    order: 80
    content: |
      群聊规则：
      - 只在被 @ 或话题相关时回复，不回复每条消息
      - 群聊中保持简短
      - 用 reactions 代替无信息量的回复
      ...（精简版 ~10 行）

  - name: "心跳执行规则"
    sessionKinds: ["heartbeat"]
    alwaysActive: true
    position: before_context
    ignoreBudget: true
    content: |
      心跳规则：
      - 执行 HEARTBEAT.md 中的任务清单；无任务则回复 HEARTBEAT_OK
      - 批量检查：邮件+日历+通知合并一轮
      ...（精简版 ~12 行）

  - name: "Memory 使用规则"
    keywords: ["memory", "记忆", "记住", "日记", "长期记忆"]
    position: after_context
    content: |
      Memory 规则：
      - 用 memory_search 语义检索，用 memory_get 读片段
      - 日记存 memory/ 目录，长期整理存 MEMORY.md
      ...（~8 行）
```

**涉及文件**：

| 文件                                           | 改动                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `src/agents/system-prompt.ts`                  | 把条件化的段落从 hardcoded builder 中移除（保留一行摘要）        |
| `src/agents/bootstrap-files.ts`                | 内置 Context Book 加载路径                                       |
| `src/agents/context-books.ts`                  | 可能需要支持"内置 Context Book"概念（跟 workspace 用户 CB 合并） |
| workspace `AGENTS.md`                          | 移除已迁移到 CB 的内容                                           |
| workspace `context-books/system-guidance.yaml` | 新建内置 guidance CB                                             |

**预估节省**：私聊场景（最常见）每轮可省 ~60 行 / ~1,000 token（群聊规则 + Reactions + 心跳规则不注入）。关键词触发的条目只在相关话题时注入，其余时候零开销。

**风险**：中。需要确保：

- 条件触发的灵敏度足够（避免需要时没注入）
- 保留在 system prompt 中的一行摘要足以让模型知道该能力存在
- 内置 CB 和用户 CB 的合并不产生冲突

**验证**：

- 私聊场景 `/context detail`：确认群聊/心跳/Reactions 规则不出现
- 群聊场景 `/context detail`：确认群聊规则正常注入
- 心跳场景 `/context detail`：确认心跳规则正常注入
- 关键词触发场景：发送含 "memory" 的消息，确认 Memory 规则注入

---

## S6：延迟加载（长期方向）

**目标**：参考 Claude Code 的 Deferred Tools 机制，把 Skill 详细描述和工具使用指南改为按需加载。

**Claude Code 的做法**：

```
系统提示词里只列名称：
<available-deferred-tools>
AskUserQuestion, WebFetch, WebSearch, ...
</available-deferred-tools>

需要用时才获取完整 schema：
→ 调用 ToolSearch("select:WebFetch") → 返回完整 JSON Schema
```

**OpenClaw 可借鉴的方向**：

- Skills 在系统提示词里只列名称 + 一句话描述，完整 SKILL.md 在调用时才加载（S3 已部分实现）
- 工具的详细使用指南（如 `cron` 工具的长描述）拆到按需读取
- AGENTS.md 中的教学内容做成"内置 skill"，首次遇到相关场景时自动加载

**暂不实施**：需要更大的架构改动（运行时 skill 动态加载机制），且收益依赖 skill 数量增长。等 S1-S5 完成后根据实际 token 数据决定是否推进。

---

## 第二阶段优化效果预估

| 步骤     | 措施               | 节省行数       | 节省 token | 难度 |
| -------- | ------------------ | -------------- | ---------- | ---- |
| S1       | 空文件不注入       | ~48 行         | ~800       | 低   |
| S2       | 去重合并           | ~90 行         | ~1,500     | 低   |
| S3       | Skill 列表压缩     | ~46 行         | ~700       | 低   |
| S4       | AGENTS.md 教学精简 | ~120 行        | ~2,000     | 中   |
| S5       | 条件注入替代全量   | ~60 行（私聊） | ~1,000     | 中   |
| **合计** |                    | **~364 行**    | **~6,000** |      |

从 ~504 行 / ~26K 字符 → ~140 行 / ~10K 字符，**精简约 62%**。

### 收益分析

即使有 prompt caching（缓存命中 1/10 价格），优化仍有意义：

1. **首次调用（cache miss）**：直接节省 ~6,000 token 的全价输入费用
2. **缓存写入成本**：更短的 prompt = 更低的 cache write 费用（cache write 比普通输入贵 25%）
3. **首次响应延迟**：更短的 prompt = 更快的 TTFT（与输入长度正相关）
4. **注意力质量**：更精简的指令 = 模型对每条规则的遵循度更高（U 型注意力效应下中间段指令容易被忽视）

## 第二阶段实施顺序

### 推荐顺序：S1 → S4 → S2 → S3 → S5

**S1 最先做**：改动最小（~10 行代码）、零风险、立即见效。

**S4 紧接**：AGENTS.md 精简不改核心代码，只改 workspace 文件，可以快速迭代验证。且 S4 的产出（精简后的规则）是 S5 的输入（要迁移到 Context Book 的内容）。

**S2 + S3 中间做**：涉及 `system-prompt.ts` 和 skills 代码改动，需要更多测试，但风险仍然可控。

**S5 最后做**：依赖 S4 的精简结果，且改动面最大（新建内置 CB、修改多个注入链路）。

### 每步完成后的检查点

每完成一步，必须：

1. 运行相关测试套件
2. 启动真实 Gateway，执行 `/context detail` 对比体积变化
3. 发送几条典型消息验证行为不退化
4. 更新 `STATUS.md` 记录实际节省数据

## 第二阶段涉及的关键文件

| 文件                             | S1  | S2  | S3  | S4  | S5  |
| -------------------------------- | --- | --- | --- | --- | --- |
| `src/agents/bootstrap-files.ts`  | ✓   |     |     |     | ✓   |
| `src/agents/system-prompt.ts`    |     | ✓   | ✓   |     | ✓   |
| `src/agents/skills/workspace.ts` |     |     | ✓   |     |     |
| `src/agents/workspace.ts`        | ✓   |     |     |     |     |
| `src/agents/context-books.ts`    |     |     |     |     | ✓   |
| workspace `AGENTS.md`            |     | ✓   |     | ✓   | ✓   |
| workspace `context-books/*.yaml` |     |     |     |     | ✓   |

---

# 第三阶段：经验资产（自动学习）

> 让 AI 从对话中自动提炼可复用的经验规则，下次遇到类似场景时直接做对，不再重复犯错。
>
> 经验资产不是新的资产类型，而是 **Context Book 的自动化层**——自动生成的 CB 条目带有生命周期管理（置信度、命中计数、废弃机制）。
>
> 参考分析：
>
> - `~/Opensource/notes/OpenClaw记忆系统架构与实现深度分析.md`（现有记忆系统能力边界）

## 核心设计

### 经验资产 = Context Book 条目 + 生命周期字段

不发明新的资产类型，复用 Context Book 的全部基础设施（关键词触发、位置控制、预算限制、validate/list/export），只扩展几个字段：

```yaml
# context-books/learned.yaml
entries:
  - name: "Gateway 重启：先查端口"
    keywords: ["重启", "gateway", "EADDRINUSE", "启动失败"]
    position: after_context
    order: 30 # 低于手写条目，预算紧张时优先跳过
    content: |
      - 重启前先 lsof -i :PORT 查占用
      - 有旧进程 → kill 后再启动
      - module not found → 先 pnpm build

    # ---- 经验扩展字段 ----
    source: auto # auto=AI 自动生成, manual=手写
    sourceSession: "session:6333cde8" # 来源会话
    confidence: high # low → medium → high → proven
    hitCount: 5 # 被触发次数
    lastHitAt: "2026-03-19" # 最近一次触发时间
    situation: | # 背景信息（不注入 prompt，AI 需要时自行读取）
      用户要求重启 Gateway 时，常见两种失败：
      端口占用(EADDRINUSE)和未编译(module not found)。
```

### 与手写条目的关系

```yaml
# context-books/cat-knowledge.yaml    ← 手写，order: 100，永远优先
# context-books/system-guidance.yaml  ← S5 迁移的系统规则，order: 60-95
# context-books/learned.yaml          ← 自动生成的经验，order: 30，用剩余预算
```

手写条目高 `order`，经验条目低 `order`。预算紧张时手写条目优先保留，经验条目优先跳过。对运行时来说全部是 Context Book 条目，零新概念。

## 触发时机

只有两个触发点，都是已有的机制：

### 触发点 1：用户主动要求

用户说"记录一下"、"整理成笔记"、"记住这个"时，插件提取当前对话中的经验。

- 零误判——用户明确要求
- 用户比 AI 更清楚什么值得记

### 触发点 2：session-memory hook（/new、/reset）

现有的 `session-memory` 内置 hook 在 `/new` 或 `/reset` 时已经会：

1. 读取最近 N 条消息
2. 调 LLM 生成会话摘要
3. 写入 `memory/YYYY-MM-DD-slug.md`

扩展方案：**在同一次 LLM 调用中，多问一句"有没有值得提炼的经验规则"**。

- 不增加新的触发点
- 不增加额外的 hook 或 LLM 调用
- 只扩展现有 hook 的 prompt 和输出解析

## 实现方案

### E1：Context Book schema 扩展

给 Context Book 条目增加可选的经验字段（不影响现有条目）：

| 字段            | 类型   | 默认值     | 说明                                                |
| --------------- | ------ | ---------- | --------------------------------------------------- |
| `source`        | string | `"manual"` | `"auto"` = AI 生成，`"manual"` = 手写               |
| `sourceSession` | string | (空)       | 来源会话 ID                                         |
| `confidence`    | string | (空)       | `low` / `medium` / `high` / `proven` / `deprecated` |
| `hitCount`      | number | (空)       | 累计触发次数                                        |
| `lastHitAt`     | string | (空)       | 最近触发日期                                        |
| `situation`     | string | (空)       | 背景信息（不注入 prompt，供 AI 按需读取）           |

这些字段对现有 CB 引擎透明——不认识就忽略，不影响触发/注入/预算逻辑。

**涉及文件**：

- `src/agents/context-books.ts`：类型定义扩展（可选字段）
- `src/cli/assets-cli.ts`：`assets validate` 识别新字段不报警告

### E2：session-memory hook 扩展

修改 `src/hooks/bundled/session-memory/handler.ts`，在生成会话摘要的同时提取经验。

**当前 prompt**（只做摘要）：

```
总结这段对话的要点。
```

**扩展后 prompt**（摘要 + 经验提取）：

```
总结这段对话。另外，如果对话中出现了以下模式，请额外提取经验规则：
- AI 犯了错误，用户纠正后成功
- 用户明确表达了偏好或要求
- 发现了某个问题的正确解决方法

对话摘要：（原有格式）

经验提取（如果有，输出 YAML；如果没有，输出 none）：
name: 简短标题
keywords: [5-8 个触发关键词]
situation: 什么场景下遇到（2 句话）
conclusion:
  - 行动规则 1
  - 行动规则 2
  - 行动规则 3
```

**输出解析**：

- 如果 LLM 输出了经验 YAML → 追加到 `context-books/learned.yaml`
- 如果输出 `none` → 不操作
- 新条目默认 `confidence: low`、`source: auto`、`order: 30`

**涉及文件**：

- `src/hooks/bundled/session-memory/handler.ts`：扩展 prompt + 解析输出 + 写入 CB

### E3：经验命中追踪

在插件的 `llm_input` hook 中追踪经验条目的命中情况。

第一阶段做的 `assetContext`（trace-viewer Phase A）已经在 `llm_input` hook payload 中包含了命中的 Context Book 条目列表。插件只需要：

1. 从 `assetContext.contextBooks.matched` 找到 `source: auto` 的条目
2. 更新对应条目的 `hitCount += 1`、`lastHitAt = today`

**涉及文件**：

- 新建 `extensions/memory-enhance/` 或扩展现有 hook

### E4：置信度演进

| hitCount | confidence |
| -------- | ---------- |
| 0        | low        |
| ≥ 3      | medium     |
| ≥ 5      | high       |
| ≥ 10     | proven     |

降级规则：

- 经验命中但 AI 仍被用户纠正 → 说明经验不完整，触发 E5 更新
- `lastHitAt` 超过 60 天 → confidence 降一级
- `lastHitAt` 超过 90 天且 confidence 为 low → 标记 `deprecated`

降级检查时机：`session_end` hook 或 `/new` 触发时顺便检查。

### E5：经验内容更新

当经验命中但 AI 仍被用户纠正时，说明经验不完整。

**检测逻辑**（在 `llm_output` hook）：

1. 本轮注入了经验条目 X（从 E3 的追踪记录中获取）
2. 本轮 AI 仍然被用户纠正（检测纠正性词汇）
3. 后续轮次成功完成

**更新方式**：
在下一次 session-memory hook 触发时（/new、/reset），扩展 prompt：

```
经验条目 "Gateway 重启：先查端口" 在本次对话中被注入，
但 AI 仍需要用户纠正。原有 conclusion 和本次新的纠正内容如下。
请输出更新后的 conclusion。
```

覆盖写入 `conclusion` 字段，更新 `updatedAt`。

### E6：用户主动触发

当用户说"记录"、"整理笔记"、"记住这个"时：

1. 收集当前对话最近 N 轮
2. 调 LLM 用和 E2 相同的 prompt 提取经验
3. 写入 `context-books/learned.yaml`

这个功能可以注册为一个新的 CLI 命令或 skill。

## 实施顺序

### 推荐顺序：E1 → E2 → E3 → E6 → E4 → E5

**E1（schema 扩展）+ E2（session-memory hook 扩展）先做**：最核心的创建流程，改动集中在一个文件（session-memory handler），复用已有的 LLM 调用。

**E3（命中追踪）紧接**：让经验有反馈循环，知道哪些被用了。

**E6（用户主动触发）中间做**：给用户直接控制权，不依赖自动检测。

**E4（置信度）+ E5（内容更新）最后做**：生命周期管理，需要积累一定数量的经验后才有意义。

## 验证方案

1. **创建验证**：执行 `/new`，检查 `context-books/learned.yaml` 是否生成了合理的经验条目
2. **注入验证**：发送包含经验关键词的消息，用 `/context detail` 确认经验条目被注入
3. **命中追踪验证**：确认 `hitCount` 和 `lastHitAt` 在命中后正确更新
4. **预算隔离验证**：经验条目不挤占高 `order` 手写条目的预算
5. **兼容验证**：没有 `learned.yaml` 时，系统行为完全不变

## 涉及的关键文件

| 文件                                          | E1  | E2  | E3  | E4  | E5  | E6  |
| --------------------------------------------- | --- | --- | --- | --- | --- | --- |
| `src/agents/context-books.ts`                 | ✓   |     |     |     |     |     |
| `src/cli/assets-cli.ts`                       | ✓   |     |     |     |     |     |
| `src/hooks/bundled/session-memory/handler.ts` |     | ✓   |     |     | ✓   |     |
| `extensions/memory-enhance/` 或新 hook        |     |     | ✓   | ✓   | ✓   | ✓   |
| workspace `context-books/learned.yaml`        |     | ✓   | ✓   | ✓   | ✓   | ✓   |
