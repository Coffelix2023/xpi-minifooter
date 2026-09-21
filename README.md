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

# Cost currency and usage detail.
cost_currency: CNY           # CNY (converted by usd_to_cny_rate) | USD
usd_to_cny_rate: 7.2         # static rate, CNY only, no network call
usage_detail: off            # off | tokens | cost | both

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

# Extra rows for native extension statuses. `max` caps how many statuses this
# row shows (1-5); omit `max` to put every remaining status in the row.
native_footer_layout:
  - separator: slash
    items:
      - { id: native_footer, max: 2 }

# Hide individual extensions by their status key. Keys are not validated
# against a fixed list, so a hidden key survives while its extension is off.
native_status:
  hidden: [rtk]

# Context warning steps, in percent.
thresholds:
  context_warn: 50
  context_alert: 75
  context_danger: 80
```

## Configuration validation

`minifooter.yml` is validated on load and after every external edit. A file that fails validation is skipped as a whole: the last valid configuration stays in effect and Pi prints one warning that names the offending fields.

```text
xpi-minifooter: invalid minifooter.yml: invalid configuration values: /native_footer_layout/3/items/1 = "mcp_skills" — keeping last valid config
```

Paths are JSON pointers into the file, and the value after `=` is what the file actually contains there. Delete or correct that entry and save — the footer reloads on the next render. Parameter ids are a closed set (the table below), so a typo fails the same way as an id removed by a later release (`mcp_skills` was dropped in 0.2.0).

Because validation is all-or-nothing, one stale id disables every other setting in the file. The warning names up to three offending paths.
## Parameters

| Parameter | Shows | Omits when |
| --- | --- | --- |
| `model_name` | Friendly `models.json` name, then model name/id | No active model |
| `model_id` | Raw model id | No active model |
| `provider` | Active provider | No active model |
| `thinking_mode` | Current thinking level | No level |
| `git_branch` | Branch and optional dirty/ahead/behind data | Outside Git or Git fails |
| `cwd_path` | Basename, home-relative, or full cwd | Cwd unavailable |
| `context_bar` | Filled/empty bar and percentage | Context window unknown shows `~%` |
| `context_compact` | Compact context percentage | Context window unknown shows `~` |
| `tokens` | Input/output totals; `usage_detail` adds cache read/write | Before the first model response |
| `cost` | Session cost in `cost_currency` (default CNY) | Cost unavailable |
| `session_time` | Elapsed session time | Start time unavailable |
| `native_footer` | Native footer extension statuses, one segment per extension | No extension statuses, or every key is hidden |

`footer_layout` accepts only these 12 ids. Lines are width-safe: `cwd_path` and `native_footer` compress first, then tail segments are dropped one at a time.

### Controlling native statuses

Extensions publish statuses through `ctx.ui.setStatus(key, text)`. The footer keeps each status as its own segment and orders them by key, matching Pi's own footer.

- **Hide one extension**: list its key in `native_status.hidden`. Matching is by key, not by the displayed text, so hiding `ponytail` keeps working after the extension changes its label from `FULL` to `ULTRA`. A key stays in the file even when its extension is not running.
- **Limit a row**: set `max` (1-5) on a `native_footer` item. Rows fill in layout order; when the total capacity is smaller than the number of statuses, the surplus is dropped. The configuration panel preview reports which statuses will not be shown.
- **Put them in the editor border**: a `border_slots` entry of `native_footer` renders every status in that corner. Border corners have no capacity limit; content that does not fit is truncated by the usual border rules.

Native status text is rendered in the muted color regardless of any color the originating extension embedded. Control sequences are stripped and whitespace is collapsed, so a status cannot add or shift footer rows. This means per-extension color cues (for example an LSP extension distinguishing active from inactive) are not preserved.

`usage_detail` detail marks: `↑` input, `↓` output, `R` cacheRead, `W` cacheWrite. Cost detail reuses the same marks for the four cost parts. The CNY rate is a static configured value — the footer never calls the network.

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
