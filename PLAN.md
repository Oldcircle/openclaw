# OpenClaw 二开计划：资产化提示词系统

> 新方向：不再把优化目标局限在“缩短 system prompt”，而是把 OpenClaw 当前零散的提示词组织方式，升级为类似 SillyTavern 的**资产化、分层化、条件注入**系统。
>
> 目标不是把 OpenClaw 变成酒馆，而是把酒馆里成熟的资产模型迁移到 Agent 场景：
>
> - 角色卡 → Agent Card
> - 世界书 → Context Book
> - 预设 → Prompt Profile

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

**P4 扩展字段（暂不实现）**：

| 字段               | 类型    | 说明                                  |
| ------------------ | ------- | ------------------------------------- |
| `sticky`           | number  | 激活后保持 N 轮（即使关键词不再出现） |
| `cooldown`         | number  | sticky 结束后冷却 N 轮不可再激活      |
| `delay`            | number  | 聊天开始后延迟 N 轮才允许激活         |
| `excludeRecursion` | boolean | 递归扫描时跳过此条目                  |
| `preventRecursion` | boolean | 此条目的内容不触发后续递归            |
| `scanDepth`        | number  | 条目专属扫描深度（覆盖全局）          |
| `tokenBudget`      | number  | 条目专属 token 上限                   |

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

- prompt modules 的注入位置偏好（`head` / `before_history` / `after_history` / `tail`）
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
- 基础注入位置（head / before_history / after_history / tail）

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
- 模型参数：`temperature` / `max_tokens`（作为默认值，显式参数优先）
- 工具范围：`tools.allow` / `tools.deny`（收缩运行时可用工具集）
- 工具偏好：`tools.prefer`（注入提示区块）
- 输出偏好：`output.format` / `output.sections` / `output.style` / `output.rules`
- 运行时行为：`output.require_final_tag`（接通 `<final>` 严格模式）
- 可观测性：`/context detail` 显示 profile 名称、模块、参数、工具范围、输出偏好
- 3/17 通过真实 Gateway + Telegram 端到端验证
- 待补：reply tags 细粒度控制、CLI `openclaw profile use` 切换命令

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

---

### P5：资产流通与导入导出

**目标**：让 Agent Card / Context Book / Prompt Profile 成为真正可流通资产。

**内容**：

- import / export
- 本地目录管理
- UI 选择器
- 版本字段
- 兼容旧 workspace 文件自动生成初始资产

## 当前推荐优先级

### 第一轮

1. P0：记录基线
2. P1：Context Book 基础版设计与最小实现
3. 保留现有 A1 类清理项，作为 P1 的前置整理
4. 保留工具描述增强 / 尾部提醒，作为 P4 的局部先行项

### 第二轮

1. P2：Agent Card
2. P3：Prompt Profile
3. P4：预算治理

### 第三轮

1. P5：导入导出和前端资产管理

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

## 验证方案

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
