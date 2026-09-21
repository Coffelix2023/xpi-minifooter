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

### 兼容性

针对 Pi **0.87.0** 开发与类型检查（`@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-tui`）。Pi 为扩展自带这些核心包，因此扩展把它们声明为 `peerDependencies: "*"`、绝不打包自备副本：运行时 API 由当前 Pi 提供，devDependencies 的版本只决定类型检查看到哪一份 `.d.ts`。

0.85–0.87 三个版本都没有需要改代码的地方：扩展只注册 `session_start`、`agent_start`、`agent_settled`、`session_shutdown` 四个事件，也不对 `SessionEntry` 或 `ExtensionEvent` 做穷尽 switch——而这两个联合类型恰好是新增成员的那两个（`usage`、`context_edit`、`agent_before_settle`、`context_with_system`）。

Pi 0.87 有两个能力本扩展刻意尚未使用，都属于可选：

- **编辑器边框钩子**：自定义编辑器直接改写首行与末行渲染结果，因此编辑器滚动时 Pi 的 `↑ N more` 溢出标记会被边框槽位覆盖。改覆写 `renderTopBorder` / `renderBottomBorder` 可以两者兼得。
- **`embedWorkingStatus`**：自定义编辑器默认保留独立的 working/compaction/重试行，把 spinner 嵌进边框是 opt-in，本扩展未启用。

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

# 费用货币与明细开关。
cost_currency: CNY           # CNY 按 usd_to_cny_rate 换算 | USD
usd_to_cny_rate: 7.2         # 静态汇率，仅 CNY 生效，不联网
usage_detail: off            # off | tokens | cost | both

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

# 原生扩展状态的额外行。`max` 限制该行最多显示几个状态（1-5）；
# 省略 `max` 表示剩余状态全部放进该行。
native_footer_layout:
  - separator: slash
    items:
      - { id: native_footer, max: 2 }

# 按扩展 key 隐藏单个扩展。key 不按固定列表校验，
# 因此扩展未运行时该条目仍会保留。
native_status:
  hidden: [rtk]

# Context 警示阈值，单位为百分比。
thresholds:
  context_warn: 50
  context_alert: 75
  context_danger: 80
```

## 配置校验

`minifooter.yml` 在加载时以及每次外部修改后都会校验。校验不通过时整份文件作废：保留上一份有效配置，并输出一条指明违规字段的警告。

```text
xpi-minifooter: invalid minifooter.yml: invalid configuration values: /native_footer_layout/3/items/1 = "mcp_skills" — keeping last valid config
```

路径是文件内的 JSON pointer（指针路径），`=` 后面是文件里实际写的内容。删掉或改正该处并保存，footer 会在下一次渲染时重载。参数 id 是闭集（见下表），因此写错拼写与「某个 id 已被后续版本删除」的表现一致（`mcp_skills` 在 0.2.0 被移除）。

校验是全有或全无，所以一个过期的 id 会让文件里的其他设置一并失效。警告最多列出三处违规路径。
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
| `tokens` | 输入/输出 token 总数；`usage_detail` 可追加缓存读写 | 首次模型响应前 |
| `cost` | 会话成本，货币由 `cost_currency` 决定（默认人民币） | 成本未知 |
| `session_time` | 会话经过时间 | 起始时间未知 |
| `native_footer` | 原生扩展状态，每个扩展一段 | 无扩展状态，或所有 key 都被隐藏 |

`footer_layout` 只接受以上 12 个 id。行宽不足时先压缩 `cwd_path` 和 `native_footer`，再从尾部逐段省略，不会清空整行。

### 控制原生状态

扩展通过 `ctx.ui.setStatus(key, text)` 发布状态。footer 把每个状态保留为独立段，并按 key 升序排列，与 Pi 原生 footer 一致。

- **隐藏某个扩展**：把它的 key 写进 `native_status.hidden`。匹配按 key 而非显示文本，所以 `ponytail` 的文案从 `FULL` 变成 `ULTRA` 后隐藏依然生效。扩展未运行时该 key 仍会保留在文件里。
- **限制每行数量**：给 `native_footer` item 设置 `max`（1-5）。行按布局顺序装填；当总容量小于状态数量时，多出的状态被丢弃。配置面板预览会列出哪些状态不会显示。
- **放进编辑器边框**：`border_slots` 中写 `native_footer` 会在该角显示全部状态。边框角没有容量上限，放不下时按既有边框规则截断。

原生状态文本统一使用 muted 配色，忽略扩展自带颜色。控制序列会被剥离、空白会被折叠，因此状态不会增加或移动 footer 行数。代价是扩展的颜色提示（例如 LSP 扩展区分活跃/非活跃）不再保留。

`usage_detail` 明细标记：`↑` 输入、`↓` 输出、`R` cacheRead、`W` cacheWrite；费用明细复用同一套标记。人民币汇率取自配置的静态值，footer 不会发起网络请求。

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
