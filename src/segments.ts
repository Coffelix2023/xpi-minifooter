/**
 * xpi-minifooter — 参数段渲染器 (task 2.1–2.4)
 *
 * 2.1 closed registry: PARAMETER_IDS 已在 config.ts, 此处补 unknown-id 校验入口。
 * 2.2 model_name: models.json name → ctx.model.name → ctx.model.id。
 * 2.3 provider / thinking_mode。
 * 2.4 cwd_path: basename / relative / full + truncateToWidth。
 *
 * 每个解析器返回 string | null;null = 省略该段。
 */
import { join, basename as pathBasename } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { truncateToWidth } from "@earendil-works/pi-tui";
import { PARAMETER_IDS, type ParameterId } from "./config.js";

/** Pi 的 7 级 thinking level(pi-agent-core `ThinkingLevel` 的本地镜像, 该包不可直接 import) */
/** Pi 的 ThinkingLevel(pi-agent-core 类型;此处本地镜像, 该包不可直接 import) */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** 渲染上下文: 由 session 层(4.1)从 pi/ctx 取值后传入, 便于单测 */
export interface SegmentContext {
  cwd: string;
  home: string;
  /** ctx.model — 无活动模型时 undefined */
  model?:
    | {
        id: string;
        name: string;
        provider: string;
      }
    | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  /** 终端可用宽度, 截断用 */
  width: number;
}

/** task 2.1: footer_layout / border_slots 中的未知 id 视为非法配置(fail-closed) */
export function isKnownParameterId(id: string): id is ParameterId {
  return (PARAMETER_IDS as readonly string[]).includes(id);
}

export function validateParameterIds(ids: readonly string[]): ParameterId[] | null {
  const out: ParameterId[] = [];
  for (const id of ids) {
    if (!isKnownParameterId(id)) return null;
    out.push(id);
  }
  return out;
}

// ─── 2.2 model_name ─────────────────────────────────────────────────────────

/** models.json 中我们唯一关心的形状; 绝不读 apiKey/headers */
interface ModelsJsonSnapshot {
  providers: Record<
    string,
    {
      models?: {
        id: string;
        name?: string;
      }[];
    }
  >;
}

let modelsJsonCache: {
  mtimeMs: number;
  data: ModelsJsonSnapshot;
} | null = null;

/** models.json → { provider → { id → name } };读失败/缺文件 → 空表(视为无友好名) */
export function loadModelNames(
  modelsPath: string,
  stat: (p: string) => {
    mtimeMs: number;
  },
  read: (p: string) => string,
): Record<string, Record<string, string>> {
  let mtimeMs: number;
  try {
    mtimeMs = stat(modelsPath).mtimeMs;
  } catch {
    modelsJsonCache = null;
    return {};
  }
  if (modelsJsonCache?.mtimeMs === mtimeMs) return indexNames(modelsJsonCache.data);
  try {
    const data = JSON.parse(read(modelsPath)) as ModelsJsonSnapshot;
    modelsJsonCache = {
      mtimeMs,
      data,
    };
    return indexNames(data);
  } catch {
    modelsJsonCache = null;
    return {};
  }
}

function indexNames(data: ModelsJsonSnapshot): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [provider, entry] of Object.entries(data.providers ?? {})) {
    const names: Record<string, string> = {};
    for (const m of entry.models ?? []) {
      if (
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        m.name.trim() !== ""
      ) {
        names[m.id] = m.name;
      }
    }
    if (Object.keys(names).length > 0) out[provider] = names;
  }
  return out;
}

/** models.json 路径(Pi 官方 API) */
export function modelsJsonPath(): string {
  return join(getAgentDir(), "models.json");
}

/** model_name 段: models.json name → ctx.model.name → ctx.model.id;无模型 → null */
export function resolveModelName(
  ctx: SegmentContext,
  names: Record<string, Record<string, string>>,
): string | null {
  const model = ctx.model;
  if (!model) return null;
  const friendly = names[model.provider]?.[model.id];
  const raw = friendly ?? (model.name.trim() !== "" ? model.name : model.id);
  return truncateToWidth(raw, ctx.width);
}

// ─── 2.2b model_id ──────────────────────────────────────────────────────────

/** model_id 段: 原始模型 ID;无模型 → null */
export function resolveModelId(ctx: SegmentContext): string | null {
  if (!ctx.model) return null;
  return truncateToWidth(ctx.model.id, ctx.width);
}

// ─── 2.3 provider / thinking_mode ───────────────────────────────────────────

/** provider 段: ctx.model.provider;无模型 → null */
export function resolveProvider(ctx: SegmentContext): string | null {
  if (!ctx.model) return null;
  return truncateToWidth(ctx.model.provider, ctx.width);
}

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  high: "high",
  low: "low",
  max: "max",
  medium: "medium",
  minimal: "minimal",
  off: "off",
  xhigh: "xhigh",
};

/** thinking_mode 段: level 文本;无 level → null。标签前缀由 display 层按 show_labels 加。 */
export function resolveThinkingMode(ctx: SegmentContext): string | null {
  if (!ctx.thinkingLevel) return null;
  return THINKING_LABELS[ctx.thinkingLevel];
}

// ─── 2.4 cwd_path ───────────────────────────────────────────────────────────

export type CwdPathMode = "basename" | "relative" | "full";

/** cwd_path 段: 三档 + 截断。 */
export function resolveCwdPath(ctx: SegmentContext, mode: CwdPathMode): string {
  let text: string;
  switch (mode) {
    case "basename":
      text = pathBasename(ctx.cwd);
      break;
    case "relative":
      text = ctx.cwd.startsWith(`${ctx.home}/`)
        ? `~${ctx.cwd.slice(ctx.home.length)}`
        : ctx.cwd;
      break;
    case "full":
      text = ctx.cwd;
      break;
  }
  return truncateToWidth(text, ctx.width);
}

// ─── 2.5 git_branch ─────────────────────────────────────────────────────────

export type GitBranchMode = "mini" | "default" | "full";

/** `git status --porcelain=v1 --branch` 的解析结果 */
export interface GitStatusData {
  ahead: number;
  behind: number;
  branch: string;
  dirty: number;
  modified: number;
  staged: number;
  untracked: number;
}

/** 解析 porcelain=v1 --branch 输出;branch 行缺失 → null */
const RE_UPSTREAM = /\.\.\.?[^\s]*/;
const RE_AHEAD_BEHIND = /\[(?:ahead (\d+))?(?:,? )?(?:behind (\d+))?\]/;
const RE_TRACK_SUFFIX = /\[.*$/;

export function parseGitStatusPorcelain(out: string): GitStatusData | null {
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("## ")) {
      const rest = line.slice(2);
      const noDot = rest.replace(RE_UPSTREAM, "");
      const ab = RE_AHEAD_BEHIND.exec(rest);
      if (ab) {
        ahead = ab[1] ? Number(ab[1]) : 0;
        behind = ab[2] ? Number(ab[2]) : 0;
      }
      const name = noDot.replace(RE_TRACK_SUFFIX, "").trim();
      if (name !== "" && !name.startsWith("No commits yet"))
        branch = name.split(" ")[0] ?? name;
    } else if (line.length >= 2) {
      const x = line[0];
      const y = line[1];
      if (x === "?" && y === "?") {
        untracked += 1;
      } else if (x === "!" && y === "!") {
        // ignored 文件不计数
      } else {
        if (x !== " " && x !== "?") staged += 1;
        if (y !== " ") modified += 1;
      }
    }
  }
  if (branch === null) return null;
  return {
    branch,
    dirty: staged + modified + untracked,
    staged,
    modified,
    untracked,
    ahead,
    behind,
  };
}

const GIT_CACHE_MS = 2000;
let gitCache: {
  at: number;
  data: GitStatusData | null;
} | null = null;

/** 测试/跨会话重置 porcelain 缓存 */
export function resetGitCache(): void {
  gitCache = null;
}

/**
 * git_branch 段。
 * - mini: 仅 branch 名, 不跑 porcelain
 * - default/full: 跑一次 porcelain(调用方传入 executor, session 层接 pi.exec + 3s timeout), 2s 缓存
 * - 非 git 仓库 / git 失败 → null
 */
export function resolveGitBranch(
  ctx: SegmentContext,
  mode: GitBranchMode,
  branchName: string | null,
  runPorcelain: () => string | null,
  now: number = Date.now(),
): string | null {
  if (!branchName) return null;
  if (mode === "mini") return truncateToWidth(branchName, ctx.width);
  if (gitCache === null || now - gitCache.at >= GIT_CACHE_MS) {
    const raw = runPorcelain();
    gitCache = {
      at: now,
      data: raw === null ? null : parseGitStatusPorcelain(raw),
    };
  }
  const data = gitCache.data;
  if (data === null) return truncateToWidth(branchName, ctx.width);
  let text: string;
  if (mode === "default") {
    text = data.dirty > 0 ? `${branchName} [±${data.dirty}]` : branchName;
  } else {
    text = `${branchName} [↑${data.ahead} ↓${data.behind} | +${data.staged} ~${data.modified} -${data.untracked}]`;
  }
  return truncateToWidth(text, ctx.width);
}

// ─── 2.6 context_bar / context_compact ──────────────────────────────────────

export interface Thresholds {
  context_alert: number;
  context_danger: number;
  context_warn: number;
}

/** pct 落在哪个档位;未知(null)→ null */
export function contextLevel(
  pct: number | null,
  t: Thresholds,
): "ok" | "warn" | "alert" | "danger" | null {
  if (pct === null) return null;
  if (pct >= t.context_danger) return "danger";
  if (pct >= t.context_alert) return "alert";
  if (pct >= t.context_warn) return "warn";
  return "ok";
}

const BAR_WIDTH = 10;
const BAR_FILLED = "█";
const BAR_EMPTY = "░";
const BAR_FILLED_ASCII = "#";
const BAR_EMPTY_ASCII = "-";

/** context_bar 段: 10 格字符条 + 百分比;未知窗口 → `~%` 标记 */
export function resolveContextBar(
  _ctx: SegmentContext,
  pct: number | null,
  _t: Thresholds,
  useAscii: boolean,
): string | null {
  if (pct === null) return useAscii ? "~%" : "~%";
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const f = useAscii ? BAR_FILLED_ASCII : BAR_FILLED;
  const e = useAscii ? BAR_EMPTY_ASCII : BAR_EMPTY;
  return `${f.repeat(filled)}${e.repeat(BAR_WIDTH - filled)} ${Math.round(clamped)}%`;
}

/** context_compact 段: 纯百分比;未知窗口 → `~` 标记 */
export function resolveContextCompact(
  _ctx: SegmentContext,
  pct: number | null,
): string | null {
  if (pct === null) return "~";
  return `${Math.round(Math.min(100, Math.max(0, pct)))}%`;
}

// ─── 2.7 tokens / cost / session_time ───────────────────────────────────────

export interface SessionUsage {
  /** 总成本(USD);未知 → null */
  costTotal: number | null;
  /** 有过至少一轮 LLM 响应 */
  hasTurn: boolean;
  inputTokens: number;
  outputTokens: number;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** tokens 段: in/out 合计;无轮次 → null(不把 0 当真实用量) */
export function resolveTokens(
  _ctx: SegmentContext,
  usage: SessionUsage,
): string | null {
  if (!usage.hasTurn) return null;
  return `↑${formatTokenCount(usage.inputTokens)} ↓${formatTokenCount(usage.outputTokens)}`;
}

/** cost 段: `$X.YZZ`;未知 → null */
export function resolveCost(_ctx: SegmentContext, usage: SessionUsage): string | null {
  if (usage.costTotal === null) return null;
  return `$${usage.costTotal.toFixed(3)}`;
}

/** session_time 段: `Xs` / `Ym Zs` / `Hh Ym`;无起始时间 → null */
export function resolveSessionTime(
  _ctx: SegmentContext,
  elapsedSeconds: number | null,
): string | null {
  if (elapsedSeconds === null) return null;
  const s = Math.max(0, Math.floor(elapsedSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ─── 4.1 display 装饰(icons / labels, session 层调用)─────────────────────────

/** nerd glyph;show_icons=false 时不加。空串 = 该段无图标 */
export const SEGMENT_ICONS: Partial<Record<ParameterId, string>> = {
  context_bar: "",
  context_compact: "",
  cost: "",
  cwd_path: "\uF07B",
  git_branch: "\uE725",
  mcp_skills: "\uF121",
  model_id: "\uF2DB",
  model_name: "\uF2DB",
  native_footer: "",
  provider: "\uF09C",
  session_time: "\uF017",
  thinking_mode: "\uF0EB",
  tokens: "",
};

/** show_labels=true 时的本地化前缀(冒号内含) */
export const SEGMENT_LABELS: Partial<
  Record<
    ParameterId,
    {
      en: string;
      zh: string;
    }
  >
> = {
  context_bar: {
    en: "Ctx:",
    zh: "上下文:",
  },
  context_compact: {
    en: "Ctx:",
    zh: "上下文:",
  },
  cwd_path: {
    en: "Dir:",
    zh: "目录:",
  },
  thinking_mode: {
    en: "Think:",
    zh: "思考:",
  },
};

/** icon + label 前缀;文本为 null 原样返回 null */
export function decorateSegment(
  id: ParameterId,
  text: string | null,
  opts: {
    lang: "zh" | "en";
    show_icons: boolean;
    show_labels: boolean;
  },
): string | null {
  if (text === null) return null;
  const icon = opts.show_icons ? (SEGMENT_ICONS[id] ?? "") : "";
  const label = opts.show_labels ? (SEGMENT_LABELS[id]?.[opts.lang] ?? "") : "";
  const prefix = [
    icon,
    label,
  ]
    .filter((s) => s !== "")
    .join(" ");
  return prefix === "" ? text : `${prefix} ${text}`;
}

// ─── 2.8 native_footer / mcp_skills ─────────────────────────────────────────

/** native_footer 段: 原生 footer 常驻状态(各扩展 setStatus 文本, 自带指示灯);空 → null */
export function resolveNativeFooter(
  ctx: SegmentContext,
  statuses: readonly string[],
): string | null {
  if (statuses.length === 0) return null;
  return truncateToWidth(statuses.join(" "), ctx.width);
}

/** 从 mcp 配置 JSON 数 server(mcpServers 键);读失败 → 0 */
export function countMcpServers(raw: string | null): number {
  if (raw === null) return 0;
  try {
    const data = JSON.parse(raw) as {
      mcpServers?: Record<string, unknown>;
    };
    return Object.keys(data.mcpServers ?? {}).length;
  } catch {
    return 0;
  }
}

/** skills 数: settings.json `skills` 数组(或对象值)+ 可选目录 */
export function countSkills(
  settingsRaw: string | null,
  skillDirs: readonly string[] = [],
): number {
  let n = 0;
  if (settingsRaw !== null) {
    try {
      const data = JSON.parse(settingsRaw) as {
        skills?: string[] | Record<string, unknown>;
      };
      if (Array.isArray(data.skills)) n += data.skills.length;
      else if (data.skills && typeof data.skills === "object")
        n += Object.keys(data.skills).length;
    } catch {
      // settings 坏 → 按 0 计
    }
  }
  return n + skillDirs.length;
}

/** mcp_skills 段: `MCP:3 · Skills:12`;双零 → null */
export function resolveMcpSkills(
  _ctx: SegmentContext,
  mcpCount: number,
  skillCount: number,
): string | null {
  if (mcpCount === 0 && skillCount === 0) return null;
  return `MCP:${mcpCount} · Skills:${skillCount}`;
}
