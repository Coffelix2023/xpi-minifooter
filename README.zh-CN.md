# xpi-minifooter

**English**: [README.md](./README.md)

面向 Pi Coding Agent 的北欧极简状态栏扩展。它运行在 Pi 主进程内，使用 Pi 原生 UI，不接管终端，不需要构建产物。

## 安装

作为 Pi package 从 npm 或 Git 安装：

```bash
pi install git:github.com/Coffelix2023/xpi-minifooter
```

本地开发可软链到扩展目录，然后在 Pi 中热载：

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-minifooter
# 在 Pi 中执行：
/reload
```

## 使用

扩展在会话开始时加载 footer。执行 `/xpi-minifooter` 打开配置面板。可用时使用 Glimpse；不可用时降级为居中的 Pi TUI modal。保存立即生效，取消不会修改配置。若其他扩展已经拥有编辑器，请保持所有 `border_slots` 为 `none`。

配置文件为 `~/.pi/agent/minifooter.yml`，外部修改会在下一次 footer 渲染时热加载：

```yaml
# 界面语言与间距。
lang: zh                    # zh | en
style: minimalist
density: comfortable       # compact | comfortable | spacious
show_icons: true
show_labels: false

# 可选编辑器边框内容。none 表示保留 Pi 原生编辑器。
border_slots:
  top_left: none
  top_right: none
  bottom_left: none
  bottom_right: none

# 按顺序渲染多行。分隔符：slash、dot、pipe、space。
footer_layout:
  - separator: slash
    items: [git_branch, cwd_path, model_name, thinking_mode]
  - separator: slash
    items: [context_bar, tokens, cost, session_time]

# Context 警示阈值，单位为百分比。
thresholds:
  context_warn: 50
  context_alert: 75
  context_danger: 80
```

## 参数

| 参数 | 显示内容 | 省略条件 |
| --- | --- | --- |
| `model_name` | `models.json` 友好名称，其次是模型 name/id | 没有活动模型 |
| `model_id` | 原始模型 ID | 没有活动模型 |
| `provider` | 当前 provider | 没有活动模型 |
| `thinking_mode` | 当前 thinking level | 没有 level |
| `git_branch` | 分支及可选 dirty/ahead/behind 信息 | 不在 Git 仓库或 Git 失败 |
| `cwd_path` | cwd 的 basename、home 相对路径或完整路径 | cwd 不可用 |
| `context_bar` | 填充条与百分比 | 窗口未知时显示 `~%` |
| `context_compact` | 紧凑 context 百分比 | 窗口未知时显示 `~` |
| `tokens` | 输入/输出 token 总数 | 首次模型响应前 |
| `cost` | 本次会话 USD 成本 | 成本未知 |
| `session_time` | 会话经过时间 | 起始时间未知 |
| `native_footer` | 原生 footer 常驻扩展状态（自带运行指示灯） | 无扩展状态 |
| `mcp_skills` | MCP server 与 skill 数量 | 两者都为零 |

`footer_layout` 只接受以上 13 个 id。行宽不足时先压缩 `cwd_path` 和 `native_footer`，再从尾部逐段省略，不会清空整行。

## 开发

仓库直接加载 TypeScript，不生成 `dist/`。使用 `mise.toml` 中锁定的工具版本：

```bash
mise install
pnpm install
pnpm typecheck
pnpm -w run lint
pnpm test
pi -e ./src/index.ts
```
