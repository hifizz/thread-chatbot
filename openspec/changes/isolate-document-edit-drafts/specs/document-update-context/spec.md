## MODIFIED Requirements

### Requirement: 新通知与读取结果仅追加在历史末尾

编译器 SHALL 在通知 Part 原有位置确定性序列化固定摘要，不查询可变 head 或自动展开全文。新格式历史通知及固定读取快照 SHALL 保留既有内容，不因后续版本、草稿编辑或轮次而动态改写。重试或重生复用原用户消息通知；新的显式读取可取得更晚的正式版本或本轮草稿快照并独立留痕。MUST NOT 将旧 @artifact 改成当前版本或修改 forkContext。

草稿读取必须以 source、draftId、baseRevisionId 和 sequence 表明其非正式身份，不能把草稿正文登记为基础 Artifact 的全文去重记录。无 source 的旧读取结果继续按原固定 Revision 解释。恢复工具结果 SHALL 使用独立持久化结果合并；缺失结果末尾追加只保证事实保留，不宣称恢复了真实事件顺序。

#### Scenario: 接受消息后文档继续更新
- **WHEN** 通知固定 R2，此后提交 R3
- **THEN** 原通知保持 R2，新显式正式读取可获得 R3；下一条消息按通知收据判断未通知变化

#### Scenario: 同轮读取两个草稿序号
- **WHEN** 本轮先读取 sequence 0，编辑后再读取 sequence 1
- **THEN** 两个已记录快照保留各自正文，后续编译不能把较早结果替换成较新草稿

#### Scenario: 草稿读取后引用基础版本
- **WHEN** 前文读取的是已修改草稿，后文显式引用其基础 Artifact
- **THEN** 草稿不消耗基础 Artifact 的全文身份，引用按固定基础正文正确展开

#### Scenario: 通知后引用同一 Artifact
- **WHEN** 前文仅有该正式版本摘要
- **THEN** 摘要不算全文，显式引用仍按既有规则展开

#### Scenario: 历史读取没有新判别字段
- **WHEN** 历史工具结果没有 source 字段但包含合法固定 Revision
- **THEN** 按旧正式读取兼容处理，不要求迁移历史消息

### Requirement: 按需读取与统一上下文预算

工具指令 SHALL 要求模型在回答相关正式文档具体内容或准备修改时读取完整内容；无关变化无需读取。没有本轮草稿时默认读取当前正式基础；已有草稿时默认读取工作副本，并明确其未发布身份。需要查看更新后的正式 head 时 SHALL 显式读取对应 Revision，不通过普通读取偷偷更换草稿基础。通知和工作副本建立本身都不是写入授权。

摘要、历史和实际读取结果 SHALL 计入现有最终请求预算；已知超限明确失败，unknown 保留真实含义和提供商错误，不静默删除、压缩或截断历史。预算不足 MUST NOT 自动发布草稿。

#### Scenario: 多份文档变化但仅讨论一份
- **WHEN** 十份文档有更新，本轮只涉及 D1
- **THEN** 提供固定摘要并按需读取 D1，不自动加载所有全文或建立所有工作副本

#### Scenario: 编辑检查导致上下文增加
- **WHEN** 多次检查草稿增加模型输入长度
- **THEN** 正常计入预算，不把缓存当作减少上下文长度，不因超限强制提交

#### Scenario: 已有草稿但正式版本发生变化
- **WHEN** 默认读取时本轮已有草稿，其他执行已经推进 head
- **THEN** 不丢弃本轮工作正文；最终提交检测冲突，需要时显式读取新正式版本并重置

### Requirement: 组件与工具状态以权威 DTO 为准

界面 SHALL 复用现有文档阅读、历史差异及组件，分离草稿过程与正式交付。组件不得自行 patch 正文、决定写入资格或把本地预览当作正式版本。edited/no_change、committed、最终 unchanged、conflict、rejected 和 abandoned 必须清晰区分。

本轮文档过程 SHALL 按 draftId 归集，检查点以 sequence 排序，所有操作结果可查看。同一轮同一文档最多显示一张新协议最终版本卡片；同一 Revision 的重复提交收据不得重复交付。旧协议真实版本不删除、不按标题合并。手机版沿用现有 Drawer 与焦点规则。

#### Scenario: 显示草稿编辑成功
- **WHEN** 服务端返回 edited
- **THEN** 显示草稿已更新但未正式提交，可查看检查点，不显示文档修改已保存或正式版本卡片

#### Scenario: 显示正式提交结果
- **WHEN** 服务端返回 committed
- **THEN** 显示固定 Revision、修改说明、差异入口和来源，过程仍可展开

#### Scenario: 重复提交回放
- **WHEN** 两个不同 toolCallId 返回同一草稿的同一 Revision
- **THEN** 保留两条调用事实，但整个消息的最终交付区只显示一张该版本卡片

#### Scenario: 最终无变化
- **WHEN** commit 返回 unchanged
- **THEN** 显示未新增版本并结束本轮草稿，不显示编辑仍在进行或新 Artifact

#### Scenario: 中断前未提交
- **WHEN** 已有实际编辑而执行终止，草稿为 abandoned
- **THEN** 明确显示草稿保留且未正式提交，不依据模型文字显示保存成功

#### Scenario: 停止前已提交
- **WHEN** commit 已成功但整条回复后来停止
- **THEN** 仍显示正式已提交事实，不改成全部未保存

#### Scenario: 草稿只读查看
- **WHEN** 用户在桌面或手机打开草稿检查点
- **THEN** 展示同一固定快照及非正式标识，不伪造 Artifact 使其成为正式 Quote/Fork 来源

## ADDED Requirements

### Requirement: 未发布编辑不进入正式更新通知和目录

项目当前文档目录、版本历史、新引用候选和跨 Thread 更新通知 SHALL 只使用正式已提交版本。草稿创建、编辑、检查点、reset、失败、abandoned 和最终 unchanged 不产生正式版本通知，也不改变当前 Artifact。正式 commit 后沿用现有通知与目录同步机制，不为草稿引入全项目自动广播。

#### Scenario: 多次草稿编辑期间其他 Thread 继续对话
- **WHEN** A 已保存多个检查点但尚未提交，B 发送新消息
- **THEN** B 的正式更新通知不包含 A 的草稿，项目目录仍指向原正式版本

#### Scenario: 最终提交后读取目录
- **WHEN** A 成功提交一个新 Revision，目录按既有机制刷新
- **THEN** 该 Document 指向新的正式版本，不出现检查点文件或重复同名文档

#### Scenario: 草稿修改后恢复原文
- **WHEN** 最终提交返回 unchanged
- **THEN** 不推进正式通知游标所依据的版本号，不产生虚假修改摘要