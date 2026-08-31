# Thread Chat 运行时 Skill

该目录是产品运行时自动发现内置 Skill 的唯一根目录。每个 Skill 使用独立子目录，并以 `SKILL.md` 为入口。

以下仓库目录只服务开发代理，永远不会被 Thread Chat 产品运行时扫描、同步或安装：

- `.agents/skills/`
- `.claude/skills/`
- `.codex/skills/`

这样可以避免把仓库维护指令、开发工具权限或代理专用工作流误发布给终端用户。

MVP 只接受：

```text
<skill>/SKILL.md
<skill>/references/**/*.md
```

MVP 明确拒绝脚本、可执行文件、二进制文件、符号链接和依赖安装。管理员本地导入即使显式传入路径，也不能把上述开发代理目录作为来源。
