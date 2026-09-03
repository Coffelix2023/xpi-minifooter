# GITHUB-GUARD

本文件只描述 `xpi-minifooter` 的仓库级 GitHub 约束。

- 仓库级 Git / GitHub 通用流程见：`docs/GIT-WORKFLOW.md`
- 当前仓库阶段、ruleset、发布入口都在这里说明

## 当前阶段

- `xpi-minifooter` 目前按**阶段一**处理：单人快速迭代优先。
- `main` 是仓库唯一保留、开发、提交、推送与发布分支。
- 本仓库不新建功能分支、修复分支、发布分支，也不开 PR；变更直接在 `main` 完成并提交。
- 当前仓库不启用 `release-please`。
- 非 `main` 分支只有在用户明确要求且确认范围后才可删除；本次整理按用户要求清理全部非 `main` 分支。
- 若以后需要多人协作或更严格流程，必须由用户明确授权后再修改本文件和 `docs/GIT-WORKFLOW.md`。
## 本仓库约束

- 只保留 `main`；不新建、不切换到其他分支。
- 允许在 `main` 直接提交、推送和发布；不得创建 PR。
- 不强推、不绕过 git hooks；删除非 `main` 分支前必须有用户明确要求与确认。
- 不改 GitHub ruleset / branch protection / 仓库 settings。
- 不把密钥 / Token 写入代码、日志、示例、文档。
- `.github/` 目录的变更必须先告知用户。

## 当前规则状态

- `guard-main` 只保留最小防线：`Block force pushes`、`Restrict deletions`。
- bypass 留空。
- 发布相关约束先按仓库现状执行，未配置 release-please。

## 分支清理规则
- 只允许 `main` 存在于本地与 `origin`。
- 已合并的非 `main` 分支应删除；未合并分支必须先审查提交内容，确认保留或丢弃后再删除。
- 不使用 force push、历史重写或覆盖式同步。
## 说明

- 这份文件只放仓库级判断，不重复写详细操作手册。
- 详细步骤统一看 `docs/GIT-WORKFLOW.md`。
