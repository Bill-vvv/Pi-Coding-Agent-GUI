# UI 信息架构重构设计

> 状态：已从固定三栏方向调整为“左侧导航 + 主工作区 + 按需上下文面板”的产品布局方向。
>
> 约束：本设计只讨论前端布局与交互组织，不改变后端 orchestrator / RPC / runtime supervisor 架构。

## 参考对象

- Claude Desktop / ChatGPT 类桌面聊天产品：左侧导航、中间主对话、底部输入。
- OpenAI Codex 开源仓库：重点学习主对话 / transcript / bottom composer 的前端布局思路，不学习其后端架构。

## 最新确认的 UI 布局需求

当前 Web GUI 阶段暂不加入顶部 App Header。顶部“文件 / 编辑 / 查看”等菜单栏留到后续 Windows 桌面端阶段再设计。

不再采用固定三栏作为产品基线。当前布局基线调整为：

```text
┌───────────────┬──────────────────────────────────────────────┐
│ Navigation    │ Main Workbench                                │
│               │                                              │
│ Projects      │ Agent Timeline / Conversation                 │
│ Recent Chats  │                                              │
│ New Chat      │ Composer fixed at bottom                      │
└───────────────┴──────────────────────────────────────────────┘

Context panels / history / settings / file views appear on demand
as modal, drawer, popover, split view, or route-level pages.
```

设计重点：

- 左侧是导航，不承担所有信息展示。
- 中间是主要工作区，优先保证对话与任务执行体验。
- 历史、设置、文件、预览、辅助信息等按需出现，不预设常驻右栏。
- 是否使用 drawer / modal / split view 由具体功能的信息密度决定。

## 区域职责

### Left Sidebar

职责：项目与对话（Pi session）导航。

应包含：

- Project 列表。
- 每个 Project 下的当前 / 最近对话入口。
- 独立的“新建对话”按钮。
- 每个 Project 行右侧预留“新建对话”图标；默认隐藏，鼠标悬置到对应 Project 时显示。
- Project / Session / Runtime 的基础状态提示。
- 收起与展开能力。

设计约束：

- 左侧栏不应直接展开完整历史 session 列表，避免被大量 Pi session 污染。
- Project 下默认只展示正在运行 / 最近少量对话。
- 完整历史必须通过独立入口进入，不挤占主导航层级。

### Main Conversation

职责：当前对话 / Runtime 的主要工作区。

要求：

- 充分留白，避免堆叠过多控制项。
- 展示当前 agent timeline / conversation 内容。
- 后续承载用户消息、assistant 输出、tool / diff / approval cards。
- Composer 固定在主区域底部。

### Context Surfaces

职责：承载非主对话内容，但不固定为第三栏。

上下文功能可以按场景采用不同形态：

- 历史对话：当前不暴露前端入口；如果后续重启，需要重新确认产品需求。
- 设置：modal、独立设置页或轻量弹层；主要承载 UI 字体、对话字体、主题、颜色、语言等界面偏好。
- 文件 / 变更 / 预览：后续根据任务形态选择 drawer、split view 或独立工作区。
- BTW 对话 / side conversation：后续单独设计，不预设为常驻右栏。

已搁置 / 不作为当前方向：

- Runtime inspector、event log、stderr、debug 信息等调试面板。

设计约束：

- 不再要求右侧边栏作为固定布局组成部分。
- 不为了“扩展性”提前保留空右栏。
- 上下文面板必须服务具体任务，默认不常驻。

### Session History Entry

当前决策：前端暂不提供历史 Pi session 的发现与恢复入口。

- 不在左侧栏显示 `恢复对话` / `查看历史对话…`。
- 不挂载 Project 级历史对话 modal / drawer。
- 不把 session 管理入口放进 Composer。
- 后端 session 索引、`session.list`、`session.resume` 可作为底层能力保留，但当前不要主动暴露为 UI 功能。
- 如果后续要重新启用，需要先确认产品需求，避免误把恢复入口加回左侧导航。

### Composer

职责：当前 Runtime 的输入与即时控制。

应包含：

- prompt textarea。
- 发送。
- 中止。
- 后续支持 slash commands、附件、快捷 prompt。

不应包含 Project 创建、Model 全局设置、Session 管理。

## 当前实现状态

### Step 1：前端布局骨架

状态：已完成第二版。

- 已移除 App Header。
- 曾调整为左侧边栏 / 中间主对话 / 右侧边栏三栏结构；当前设计方向已改为左侧导航 + 主工作区，右侧不再作为固定常驻栏。
- 左侧边栏展示项目、对话 / Runtime、新建对话入口。
- 每个 Project 右侧 hover 后显示新建对话 icon。
- 中间主对话区域充分留白，Composer 固定在底部。
- 不再为空的右侧拓展栏预留固定空间。
- 左侧导航支持收起 / 展开；其他上下文内容按需以 modal / drawer / split view 等方式出现。
- 未改后端。

### Step 2：Session UI

状态：前端入口已撤销，当前暂不做。

- Project 下只显示正在运行 / 已托管 runtime 对话，不直接展开历史 session 预览。
- 不提供轻量“历史对话”入口，也不挂载 Project 级历史 modal。
- 后端 session 索引 / resume 能力可保留为底层能力，但不要主动暴露为当前 UI 功能。

## 后续阶段

### Step 3：Timeline 化

### Step 3：Timeline 化

状态：已有基础版；本轮确认先跳过增强，作为后续可扩展空间。

- 现有主对话已支持 message blocks、thinking、tool group、处理过程与 tool 明细展示。
- 后续如果需要更繁杂的信息流，可通过 display mode / timeline card 扩展。
- stderr / raw event 暂不进入右侧调试面板；当前不做 Runtime inspector / raw event debug UI。

### Step 4：设置页 / 设置弹层

状态：已完成基础版。

- Settings 中已新增 UI 字体大小、对话字体大小、主题与强调色入口。
- 模型设置不归入 Settings；模型选择继续跟随 Project / Runtime / Session 语境，并保留 Composer 快捷控制。
- 语言设置后续可作为界面偏好加入 Settings。

## 已确认方向

Pi GUI 当前采用：

> 左侧导航 + 主工作区 + 按需上下文面板

不再把三栏结构作为后续 UI 信息架构的默认方向。当前不加入上栏；桌面端菜单后续再设计。
