# UI 信息架构重构设计

> 状态：三栏方向已确认，并已完成第一轮前端骨架重构。
>
> 约束：本设计只讨论前端布局与交互组织，不改变后端 orchestrator / RPC / runtime supervisor 架构。

## 参考对象

- Claude Desktop / ChatGPT 类桌面聊天产品：左侧导航、中间主对话、底部输入。
- OpenAI Codex 开源仓库：重点学习主对话 / transcript / bottom composer 的前端布局思路，不学习其后端架构。

## 最新确认的 UI 布局需求

当前 Web GUI 阶段暂不加入顶部 App Header。顶部“文件 / 编辑 / 查看”等菜单栏留到后续 Windows 桌面端阶段再设计。

采用 Agent GUI 经典三栏设计：

```text
┌───────────────┬───────────────────────────────┬────────────┐
│ Left Sidebar  │ Main Conversation             │ Right Bar  │
│               │                               │            │
│ Projects      │ Agent Timeline / Conversation │ Future     │
│ Sessions      │                               │ Extensions │
│ New Chat      │                               │            │
│               │                               │            │
│               │ Composer fixed at bottom      │            │
└───────────────┴───────────────────────────────┴────────────┘
```

## 区域职责

### Left Sidebar

职责：项目与对话（Pi session）导航。

应包含：

- Project 列表。
- 每个 Project 下的对话 / Session 列表。
- 独立的“新建对话”按钮。
- 每个 Project 行右侧预留“新建对话”图标；默认隐藏，鼠标悬置到对应 Project 时显示。
- Project / Session / Runtime 的基础状态提示。
- 收起与展开能力。

### Main Conversation

职责：当前对话 / Runtime 的主要工作区。

要求：

- 充分留白，避免堆叠过多控制项。
- 展示当前 agent timeline / conversation 内容。
- 后续承载用户消息、assistant 输出、tool / diff / approval cards。
- Composer 固定在主区域底部。

### Right Sidebar

职责：预留扩展功能区。

当前阶段默认收起，暂不加入具体功能。

后续可能包含：

- BTW 对话 / side conversation。
- 文件浏览或文件变更视图。
- 浏览器 / Web 预览。
- Runtime inspector、event log、stderr、debug 信息等开发辅助功能。

右侧边栏必须支持收起与展开。

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
- 已调整为左侧边栏 / 中间主对话 / 右侧边栏三栏结构。
- 左侧边栏展示项目、对话 / Runtime、新建对话入口。
- 每个 Project 右侧 hover 后显示新建对话 icon。
- 中间主对话区域充分留白，Composer 固定在底部。
- 右侧边栏默认收起，作为拓展功能预留。
- 左右侧边栏均支持收起 / 展开。
- 未改后端。

## 后续阶段

### Step 2：Session UI

- Project 下显示真实 Pi sessions。
- 支持 resume。
- 支持 runtime reattach / restart 入口。

### Step 3：Timeline 化

- 将 assistant stream 与 runtime events 分离。
- 把 Pi events 归类成 timeline cards。
- stderr / raw event 进入右侧边栏或开发调试视图。

### Step 4：设置页 / 设置弹层

- 模型设置从临时侧栏位置移入 Settings。
- Provider 设置预留。
- 语言设置预留。

## 已确认方向

Pi GUI 采用：

> 左侧边栏 + 中间主对话 + 右侧边栏

三栏结构作为后续 UI 信息架构重构方向。当前不加入上栏；桌面端菜单后续再设计。
