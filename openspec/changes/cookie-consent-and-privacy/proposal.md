## Why

Beta 将面对不同语言和地区的用户。不能用英文界面等同地区判断，也不能在同意之前发送可选分析。必须先定义数据用途、同意和删除边界，再接入产品分析。

## What Changes

- 全球统一采用必要功能开启、可选分析明确同意后开启的 Beta 默认体验。
- 双语同意面板、拒绝与接受同级操作、随时撤回；第一版不启用广告、session replay 或泛化 autocapture。
- 同意事实同时约束浏览器和服务端分析，不排队/补传拒绝期间的行为。
- 分类管理诊断内容、处理商、保留期及经身份验证的导出/删除请求。

## Capabilities

### New Capabilities

- `beta-privacy-consent`: 可选分析授权、数据用途及用户数据请求。

### Modified Capabilities

无。现有日志脱敏规则保持可配置，本 change 规定对外 Beta 的告知、权限及用途，避免本人调试配置无条件用于所有用户。

## Impact

计划增加 lib/privacy、同意组件、设置/页脚入口及数据请求记录；不在本 PR 安装 SDK 或启用分析。

## Dependencies

Git 父分支 spec/beta-01-internationalization（#163）。06 产品分析必须消费此契约，不能先全量采集再补弹窗。服务账务仍独立完成。

## Non-goals

不实现地理识别服务、广告平台、复杂隐私工单、自动法律结论或对所有地区合规的保证。政策内容和实际处理配置必须在开放前审核。
