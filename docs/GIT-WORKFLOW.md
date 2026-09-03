# Git 工作流与安全生产规范

> 本文件是当前项目的 Git / GitHub 流程单一事实来源。
> 如果它与其他文档冲突，以本文件为准。

## 1. 目标

让 Agent 在当前项目中安全地处理：
- 本地分支与工作区
- 远端同步
- 提交、推送、开 PR
- 发布与 Release PR
- ignore / secret / 覆盖风险

## 2. 默认原则
- 本仓库采用单分支流程，`main` 是唯一开发、提交、同步与发布分支。
- 不新建、不切换到功能分支、修复分支或发布分支。
- 所有提交必须小粒度、可回滚。
- 任何会覆盖、丢失、重写历史的操作都要先停下并说明风险。
- 先看状态，再动 Git。
## 3. 每次 Git 动作前的固定顺序

只要任务碰到 Git / GitHub / 远端仓库 / release，先按顺序做：
1. `git branch --show-current`，必须确认是 `main`。
2. `git status --short`。
3. `git diff --stat`。
4. `git remote get-url origin`；仅成功时执行 `git fetch origin`。
5. 检查 `main` 与 `origin/main` 的关系；若有未提交改动、分叉或冲突，先停下说明。
6. 不执行建分支、切分支或开 PR；修改完成后只在 `main` 提交，并按用户授权决定是否推送。
所有 Git 动作都必须在 `main` 上继续：
- 若当前不是 `main`，先切回 `main`，不在其他分支提交。
- 不创建、不切换、不推送任何非 `main` 分支。
- 只在工作区干净且 `main` 与 `origin/main` 关系明确时继续。
## 4. 分支规则
- 本仓库只保留 `main`。
- 不创建功能分支、修复分支、发布分支或临时分支。
- 已合并的非 `main` 分支按用户授权清理；未合并分支先审查提交内容，再决定保留或丢弃。
## 5. 暂存与提交

- 优先使用 `git add <specific-file>`。
- 不默认使用 `git add .` 或 `git add -A`。
- 新脚手架首次提交必须显式暂存生成文件与 `pnpm-lock.yaml`。
- 提交前运行 `git check-ignore -v node_modules dist`、`git diff --cached --check` 与 `git diff --cached --stat`。
- Git identity 缺失时保留 staged 状态并报告；禁止修改 global identity。
- 提交信息用 Conventional Commits：`<type>(<scope>): <subject>`。
- 禁止空泛提交名：`update`、`wip`、`fix bug`。
- 提交前先展示 `git status` 和 `git diff` 摘要给用户。

## 6. 远端同步

- 存在 `origin` 时先 `git fetch origin`；无远端时跳过。
- 如果本地落后，优先 `git pull --rebase`。
- 如果有未提交改动，先停，不直接拉取覆盖。
- 如果分叉或冲突，先说明，不猜测，不 force。

## 7. 推送与发布
- 只从已验证的 `main` 推送与发布。
- 本仓库不开 PR，不创建 Release PR；发布按项目已有入口执行。
- Agent 不修改 GitHub ruleset、branch protection 或仓库 settings。
## 8. 安全红线

绝对禁止，除非用户明确要求并确认后再执行：
- `git push --force`
- `git push -f`
- `git push --force-with-lease`
- `git reset --hard`
- `git checkout .`
- `git restore .`
- `git clean -fd`
- `git commit --amend`（尤其是已 push 后）
- `gh pr merge`
- `--no-verify`
- 修改 GitHub ruleset / branch protection / 仓库 settings

## 9. 密钥与 ignore

- `.env`、`.env.*`、`*.pem`、`*.key`、`secrets/`、`node_modules/`、`dist/`、`.next/`、`coverage/`、`__pycache__/` 必须被忽略。
- 如果发现该忽略却已被跟踪的文件，先停，再处理。
- 不要把 Token、密钥、完整用户数据写进代码、日志、示例或文档。

## 10. 项目阶段

- 具体项目阶段、ruleset、release 细则，放在该项目的 `docs/GITHUB-GUARD.md`。
- 这份文件只定义通用工作流，不定义某个项目的阶段编号或发布状态。

## 11. 用户最常见动作

### 11.1 本地改完后
1. 看 `git status`
2. 看 `git diff`
3. 精确 `git add`
4. 约定式提交
5. 再决定 push 还是继续改

## 11. 用户最常见动作
### 11.1 本地改完后
1. 确认在 `main`。
2. 看 `git status` 和 `git diff`。
3. 精确 `git add`。
4. 运行验证命令。
5. 约定式提交。
6. 按用户授权推送 `main`。

### 11.2 需要同步远端
1. `git fetch origin`。
2. 检查是否有本地未提交改动。
3. 如果只是落后，使用快进同步；如果分叉或冲突，先停。

### 11.3 需要发布
1. 确认 `main` 已通过验证且与远端关系明确。
2. 按项目发布入口从 `main` 执行。
## 12. 说明

- 具体项目级阶段、ruleset、release 细则，放在该项目的 `docs/GITHUB-GUARD.md`。
- 旧的 Git 说明文档只保留短指针，不再重复写完整规则。
