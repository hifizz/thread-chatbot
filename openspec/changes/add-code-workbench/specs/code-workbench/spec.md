# Spec Delta: code-workbench

## ADDED Requirements

### Requirement: AI 生成可预览的 React Demo

系统 SHALL 提供 `createDemo` 后端工具：当用户请求编写 React 组件、页面、动效或 UI Demo 时，模型通过一次工具调用输出完整的多文件 Demo（title、files、可选 dependencies），入口文件为 `/App.tsx`。

#### Scenario: 用户请求组件 Demo

- **WHEN** 用户发送"帮我写一个基于 Tailwind CSS、framer-motion 的 React Dialog 弹窗组件"
- **THEN** 模型调用 createDemo 输出可运行的多文件 TSX 代码，消息中出现 artifact 卡片，右侧工作台自动打开

### Requirement: 工作台实时预览与代码视图

工作台面板 SHALL 在浏览器沙箱中运行生成的 Demo 并提供「预览 / 代码」双视图：预览为可交互的实时渲染（Tailwind 原子类、framer-motion 动效、lucide 图标生效），代码视图提供带文件标签与语法高亮的编辑器。生成流式期间 SHALL 展示代码逐步写入，完成后 SHALL 自动切换到预览。

#### Scenario: 生成完成自动切换预览

- **WHEN** createDemo 工具参数流式结束
- **THEN** 面板从代码视图自动切换到预览视图，Demo 完成一次干净构建并可交互

#### Scenario: 预览中交互

- **WHEN** 用户在预览中点击 Demo 的触发按钮
- **THEN** 组件按生成代码的逻辑响应（如弹窗以动画打开）

### Requirement: Demo 随会话持久化

Demo 内容 SHALL 随消息（UIMessage JSONB）持久化：刷新页面或切换会话后，历史消息中的 artifact 卡片 SHALL 可重新打开对应 Demo，且不自动弹出面板打扰用户。

#### Scenario: 刷新后恢复

- **WHEN** 用户刷新页面并进入包含 Demo 的历史会话
- **THEN** artifact 卡片正常显示文件数与标题，点击后工作台重新渲染该 Demo

### Requirement: 生成代码的防御式规整

系统 SHALL 对模型输出做防御式规整以保证预览尽量可运行：文件路径归一化为以 `/` 开头、`@/` 别名 import 改写为相对路径、缺失 `/App.tsx` 时以首个组件文件兜底为入口、内置 `cn()` 工具文件、忽略模型对宿主保留依赖（react/react-dom/next）的版本声明。

#### Scenario: 模型使用 shadcn 风格别名

- **WHEN** 模型生成的文件中包含 `import { cn } from "@/lib/utils"`
- **THEN** 预览沙箱将其解析为对应的相对路径并正常构建
