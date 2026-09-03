# xpi-minifooter

**简体中文**: [README.zh-CN.md](./README.zh-CN.md)

A small Nordic-minimalist status footer for the Pi Coding Agent. It runs as a Pi extension, uses Pi-native UI, and does not take over the terminal or add a build step.

## Install

Install as a Pi package from npm or Git:

```bash
pi install git:github.com/Coffelix2023/xpi-minifooter
```

For local development, symlink the repository and reload Pi:

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-minifooter
# In Pi:
/reload
```

## Use

The footer is loaded on session start. Run `/xpi-minifooter` to open the configuration panel. Glimpse is used when available; otherwise Pi shows a centered TUI modal. Saving applies immediately; cancelling changes nothing. If another extension owns the editor, leave all `border_slots` set to `none`.

Configuration lives at `~/.pi/agent/minifooter.yml` and reloads on the next footer render:

```yaml
# UI language and spacing.
lang: zh                    # zh | en
style: minimalist
density: comfortable       # compact | comfortable | spacious
show_icons: true
show_labels: false

# Optional editor border content. Use none to keep Pi's native editor.
border_slots:
  top_left: none
  top_right: none
  bottom_left: none
  bottom_right: none

# Rows are rendered in order. Supported separators: slash, dot, pipe, space.
footer_layout:
  - separator: slash
    items: [git_branch, cwd_path, model_name, thinking_mode]
  - separator: slash
    items: [context_bar, tokens, cost, session_time]

# Context warning steps, in percent.
thresholds:
  context_warn: 50
  context_alert: 75
  context_danger: 80
```

> Remove the accidental leading space before `density` if copying this example; it should be `density: comfortable` at the document root.

## Parameters

| Parameter | Shows | Omits when |
| --- | --- | --- |
| `model_name` | Friendly `models.json` name, then model name/id | No active model |
| `provider` | Active provider | No active model |
| `thinking_mode` | Current thinking level | No level |
| `git_branch` | Branch and optional dirty/ahead/behind data | Outside Git or Git fails |
| `cwd_path` | Basename, home-relative, or full cwd | Cwd unavailable |
| `context_bar` | Filled/empty bar and percentage | Context window unknown shows `~%` |
| `context_compact` | Compact context percentage | Context window unknown shows `~` |
| `tokens` | Input/output totals | Before the first model response |
| `cost` | Session USD cost | Cost unavailable |
| `session_time` | Elapsed session time | Start time unavailable |
| `packages` | Installed Pi package short names | No packages |
| `mcp_skills` | MCP server and skill counts | Both counts are zero |

`footer_layout` accepts only these 12 ids. Lines are width-safe: `cwd_path` and `packages` compress first, then tail segments are dropped one at a time.

## Development

This repository loads TypeScript directly; there is no `dist/` build. With the pinned tools from `mise.toml`:

```bash
mise install
pnpm install
pnpm typecheck
pnpm -w run lint
pnpm test
pi -e ./src/index.ts
```
