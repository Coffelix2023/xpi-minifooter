# AGENTS.md — xpi-minifooter

> 本文件是本仓库内 AI Agent 与人类开发者的**唯一事实来源 (Single Source of Truth)**。
> 所有变更必须可解释、可回滚。当口头约定、历史代码与本文件冲突时,**以本文件为准**。

<!-- TODO: 定义本扩展职责边界(这个扩展做什么、不做什么) -->

## 0. TL;DR(Agent 执行守则)

- 每次对话头部声明 "[@xpi-minifooter-AGENTS.md]".
- 本仓库是一个 **Pi Coding Agent 扩展 (pi-extension)**,即被 Pi 主进程加载的 Node.js 插件。**不是 Web 应用**。
- **核心栈**:TypeScript (strict) + Node.js + Pi 原生 UI(`ctx.ui.*` / `@earendil-works/pi-tui`)+ Biome + pnpm + Vitest + typebox。
- **无构建步骤**:Pi 直接加载 `src/index.ts` TypeScript 源码。禁止引入 tsup/esbuild/dist 产物。
- **类型真相**:Pi 的 API 签名以 `node_modules/@earendil-works/*` 的 `.d.ts` 为准。**动手前先读类型,不凭记忆猜 API**。
- 任何代码修改后,必须分别保证 `pnpm typecheck`、`pnpm -w run lint`、`pnpm test` 全部通过,否则视为未完成。

## 1. 运行时契约

1. 入口 `src/index.ts` 默认导出 register 函数:`export default function (pi: ExtensionAPI): void`。
2. `package.json` 的 pi manifest 指向 TS 源码:`{ "pi": { "extensions": ["./src/index.ts"] } }`。
3. Pi API 与 typebox 声明为 **peerDependencies(optional)**,版本锁在 devDependencies。
4. 扩展运行在 Pi 主进程内,终端归 Pi TUI 所有。交互一律用 `ctx.ui.*`,禁止 ink/inquirer 等抢终端的库。
5. 尊重 Project Trust:项目级配置(`<cwd>/.pi/*.json`)仅在项目被信任时生效。

## 2. 技术栈

Node.js + pnpm(版本见 `mise.toml`)、TypeScript strict、Biome(lint+format)、Vitest、typebox。
**实装版本以 pnpm-lock.yaml 为准**,不在本文件硬写大版本号。

## 3. 目录结构

```
.
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md
└── src/
    └── index.ts           # 扩展入口(register);领域目录(tools/ commands/ lib/ 等)由项目按需增设
```

`skills/`、`prompts/` 等资源目录在**有真实内容时**再加入 pi manifest,不预建空目录。

## 4. 编码与 API 约定

- **Tools**:每个 Tool 用 typebox 声明输入 Schema;只读与变更工具严格分离;输出必须有界(大输出先截断/摘要)。
- **Hooks**:生命周期事件以安装版本类型为准;钩子内不做重活,重活放异步任务或子进程。
- **Prompt Hygiene**:永不修改 Pi 的 system prompt;注入指令用对话消息追加,精简、可移除,空闲不注入。
- **配置与密钥**:配置解析 fail-closed;Token/API Key 绝不写入代码、日志、示例或文档,仅经环境变量或 `chmod 0600` 文件存储,日志一律脱敏。
- **视觉与 TUI 规范**：所有涉及终端渲染、状态栏、通知与字符排版的改动，必须严格遵循根目录
`DESIGN.md` 中的 Token 与 8 大章节规范

## 5. 命令与开发回路

```bash
pnpm typecheck        # tsc --noEmit
pnpm -w run lint      # workspace root: biome check .
pnpm test             # vitest run
```

- 提交前三条全绿。
- 若 lint 输出意外出现 ESLint,先确认 `scripts.lint` 仍为 `biome check .`,再运行 `pnpm exec biome check .` 诊断;禁止安装 ESLint。
- **冒烟**:`pi -e ./src/index.ts`(quick test,不支持热载)。
- **日常开发**:软链到 `~/.pi/agent/extensions/xpi-minifooter`,在 Pi 内 `/reload` 热载。

## 6. Git 与回滚纪律
- 只要任务碰到 git / GitHub / 远端仓库 / release，先读 `docs/GIT-WORKFLOW.md`、`docs/GITHUB-GUARD.md`，并先执行 `git branch --show-current`、`git status --short`、`git diff --stat`、`git fetch origin`。
- 本仓库采用单分支流程：代码修改、提交、推送与发布一律只在 `main` 中进行；禁止新建或切换到其他工作分支。
- 进入任务前确认当前分支是 `main`；若不是，先回到 `main`，不要在其他分支提交。
- 提交前检查远端关系、暂存内容与敏感文件；保持提交小粒度、可回滚，并使用 Conventional Commits。
- 暂存用 `git add <specific-file>`；不用 `git add .` / `git add -A`。
- 不使用 `git push --force`、`git push -f`、`git push --force-with-lease`、`git reset --hard`、`git checkout .`、`git restore .`、`git clean -fd`、`git commit --amend` 或 `--no-verify`。
- 仅在用户明确要求且确认范围后删除已合并的非 `main` 分支；不修改 GitHub ruleset、branch protection 或仓库 settings。
- 发布直接从已验证的 `main` 执行；不创建发布分支，不开 PR，不代替人类完成需要 UI 确认的仓库设置操作。
- 发现工作区有未提交改动、分叉、冲突、远端不存在或 ignore 对不上时先停下说明，不猜测、不覆盖。

## 7. 禁止清单
- ❌ 引入 Web 交付框架(`next`/`react-dom`/路由框架)或浏览器专属 API.
- ❌ 引入 tsup/esbuild 等构建步骤或提交 `dist/`.
- ❌ 引入 ink/`@inquirer/prompts` 等接管终端的库.
- ❌ 使用 `any` / 关闭 strict / 绕过 Biome.
- ❌ 在日志或错误信息中打印 Token、完整用户数据.
- ❌ 凭记忆调用 Pi API;必须先读 `@earendil-works/*` 类型定义.
