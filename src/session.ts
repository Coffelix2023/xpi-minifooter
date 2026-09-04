/**
 * xpi-minifooter — session 接线 (task 4.1)
 *
 * session_start: load config → setFooter → 条件 setEditorComponent →
 * mtime 热重载 → onBranchChange / agent_start / agent_settled 渲染 →
 * session_shutdown 复位。
 *
 * Pi ctx 取数在这一层; 纯渲染在 footer.ts / editor-border.ts / segments.ts。
 * deps 可注入, 单测用 mocks 跑通完整接线。
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type KeybindingsManager,
  type ReadonlyFooterDataProvider,
  type SessionEntry,
  type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
  configPath,
  DEFAULT_CONFIG,
  type LoadedConfig,
  loadConfig,
  loadConfigWithError,
  type MinifooterConfig,
  slotValues,
} from "./config.js";
import {
  type BorderSlotId,
  renderBorderLine,
  shouldInstallEditor,
} from "./editor-border.js";
import {
  contextTokenFor,
  type FooterRowData,
  type FooterSegment,
  renderFooter,
  thinkingColorToken,
} from "./footer.js";
import {
  countMcpServers,
  countSkills,
  decorateSegment,
  loadModelNames,
  modelsJsonPath,
  resolveContextBar,
  resolveContextCompact,
  resolveCost,
  resolveCwdPath,
  resolveGitBranch,
  resolveMcpSkills,
  resolveModelId,
  resolveModelName,
  resolveNativeFooter,
  resolveProvider,
  resolveSessionTime,
  resolveThinkingMode,
  resolveTokens,
  type SegmentContext,
  type SessionUsage,
  type ThinkingLevel,
} from "./segments.js";

/** 可注入依赖(默认用真实 fs / Pi API) */
export interface RuntimeDeps {
  configPath?: () => string;
  loadConfig?: (path: string) => LoadedConfig | null;
  loadConfigWithError?: (path: string) => {
    loaded: LoadedConfig | null;
    error: string | null;
  };
  now?: () => number;
  statMtime?: (path: string) => number | null;
}

/** git porcelain 取数(2s 缓存 + 3s timeout; async 写缓存, render 内同步读) */
export function fetchPorcelain(
  pi: {
    exec(
      cmd: string,
      args: string[],
      opts?: {
        cwd?: string;
        timeout?: number;
      },
    ): Promise<{
      stdout: string;
    }>;
  },
  runtime: SessionRuntime,
  cwd: string,
): string | null {
  if (runtime.config.git_branch_mode === "mini" || runtime.porcelain.inflight) {
    return runtime.porcelain.raw;
  }
  const now = Date.now();
  if (now - runtime.porcelain.at < PORCELAIN_CACHE_MS) return runtime.porcelain.raw;
  runtime.porcelain.at = now;
  runtime.porcelain.inflight = true;
  void pi
    .exec(
      "git",
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "--branch",
      ],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
      },
    )
    .then((r) => {
      runtime.porcelain.raw = r.stdout;
    })
    .catch(() => {
      runtime.porcelain.raw = null;
    })
    .finally(() => {
      runtime.porcelain.inflight = false;
    });
  return runtime.porcelain.raw;
}

const PORCELAIN_CACHE_MS = 2000;
const GIT_TIMEOUT_MS = 3000;

/** session entries → tokens/cost/hasTurn(参照官方 custom-footer 示例) */
export function aggregateUsage(entries: readonly SessionEntry[]): SessionUsage {
  let input = 0;
  let output = 0;
  let cost = 0;
  let hasTurn = false;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = (
      entry as {
        message?: {
          role?: unknown;
          usage?: {
            input?: number;
            output?: number;
            cost?: {
              total?: number;
            };
          };
        };
      }
    ).message;
    if (message?.role !== "assistant") continue;
    const usage = message.usage;
    if (!usage) continue;
    hasTurn = true;
    input += usage.input ?? 0;
    output += usage.output ?? 0;
    cost += usage.cost?.total ?? 0;
  }
  return {
    costTotal: hasTurn ? cost : null,
    inputTokens: input,
    outputTokens: output,
    hasTurn,
  };
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** MCP 计数: 项目 <cwd>/.pi/mcp.json + 用户 agent dir/mcp.json(缺失 = 0) */
export function countMcpFromRaws(
  projectRaw: string | null,
  userRaw: string | null,
): number {
  return countMcpServers(projectRaw) + countMcpServers(userRaw);
}

/** 渲染所需输入; collectInputs 从 Pi ctx 取数, buildFooterRows 纯消费 */
export interface SegmentInputs {
  branchName: string | null;
  contextPct: number | null;
  contextTokens?: number | null;
  contextWindow?: number | null;
  cwd: string;
  elapsedSeconds: number | null;
  home: string;
  mcpCount: number;
  model?:
    | {
        id: string;
        name: string;
        provider: string;
      }
    | undefined;
  modelNames: Record<string, Record<string, string>>;
  nativeStatuses: string[];
  skillCount: number;
  thinkingLevel: ThinkingLevel | null;
  usage: SessionUsage;
}

/** 从 Pi ctx 收集渲染输入(文件读失败按缺省, 不抛) */
export function collectInputs(
  pi: Pick<ExtensionAPI, "getThinkingLevel">,
  ctx: ExtensionContext,
  runtime: SessionRuntime,
  branchName: string | null,
  nativeStatuses: readonly string[] = [],
): SegmentInputs {
  const contextUsage = ctx.getContextUsage();
  const agentDir = getAgentDir();
  const settingsRaw = readTextFile(join(agentDir, "settings.json"));
  const modelNames = loadModelNames(
    modelsJsonPath(),
    (p) => ({
      mtimeMs: statSync(p).mtimeMs,
    }),
    (p) => readFileSync(p, "utf8"),
  );
  return {
    branchName,
    contextPct: contextUsage?.percent ?? null,
    contextTokens: contextUsage?.tokens ?? null,
    contextWindow: contextUsage?.contextWindow ?? null,
    cwd: ctx.cwd,
    elapsedSeconds:
      runtime.startAt === 0 ? null : (Date.now() - runtime.startAt) / 1000,
    home: process.env.HOME ?? process.env.USERPROFILE ?? "",
    mcpCount: countMcpFromRaws(
      readTextFile(join(ctx.cwd, ".pi", "mcp.json")),
      readTextFile(join(agentDir, "mcp.json")),
    ),
    model: ctx.model
      ? {
          id: ctx.model.id,
          name: ctx.model.name,
          provider: ctx.model.provider,
        }
      : undefined,
    modelNames,
    skillCount: countSkills(settingsRaw),
    thinkingLevel: pi.getThinkingLevel(),
    usage: aggregateUsage(ctx.sessionManager.getBranch()),
    nativeStatuses: [
      ...nativeStatuses,
    ],
  };
}

/** 单段渲染(id → 着色文本段); null = 省略 */
export function renderSegment(
  id: string,
  config: MinifooterConfig,
  inputs: SegmentInputs,
  width: number,
  runPorcelain: () => string | null,
  showIcon?: boolean,
): FooterSegment | null {
  const ctx: SegmentContext = {
    cwd: inputs.cwd,
    home: inputs.home,
    model: inputs.model,
    thinkingLevel: inputs.thinkingLevel ?? undefined,
    width,
  };
  let text: string | null;
  switch (id) {
    case "context_bar":
      text = resolveContextBar(
        ctx,
        inputs.contextPct,
        config.thresholds,
        false,
        inputs.contextTokens ?? null,
        inputs.contextWindow ?? null,
      );
      break;
    case "context_compact":
      text = resolveContextCompact(ctx, inputs.contextPct);
      break;
    case "cost":
      text = resolveCost(ctx, inputs.usage);
      break;
    case "cwd_path":
      text = resolveCwdPath(ctx, config.cwd_path_mode);
      break;
    case "git_branch":
      text = resolveGitBranch(
        ctx,
        config.git_branch_mode,
        inputs.branchName,
        runPorcelain,
      );
      break;
    case "mcp_skills":
      text = resolveMcpSkills(ctx, inputs.mcpCount, inputs.skillCount);
      break;
    case "model_name":
      text = resolveModelName(ctx, inputs.modelNames);
      break;
    case "model_id":
      text = resolveModelId(ctx);
      break;
    case "native_footer":
      text = resolveNativeFooter(ctx, inputs.nativeStatuses);
      break;
    case "provider":
      text = resolveProvider(ctx);
      break;
    case "session_time":
      text = resolveSessionTime(ctx, inputs.elapsedSeconds);
      break;
    case "thinking_mode":
      text = resolveThinkingMode(ctx);
      break;
    case "tokens":
      text = resolveTokens(ctx, inputs.usage);
      break;
    default:
      return null;
  }
  const decorated = decorateSegment(id, text, {
    lang: config.lang,
    show_icons: showIcon ?? config.show_icons,
    show_labels: config.show_labels,
  });
  if (decorated === null) return null;
  return {
    id,
    colorToken: colorTokenFor(id, inputs, config),
    text: decorated,
  };
}

function colorTokenFor(
  id: string,
  inputs: SegmentInputs,
  config: MinifooterConfig,
): FooterSegment["colorToken"] {
  if (id === "thinking_mode") return thinkingColorToken(inputs.thinkingLevel);
  if (id === "context_bar" || id === "context_compact") {
    return contextTokenFor(inputs.contextPct, config.thresholds);
  }
  return null;
}

/** footer_layout → 行数据(空段过滤) */
export function buildFooterRows(
  config: MinifooterConfig,
  inputs: SegmentInputs,
  width: number,
  runPorcelain: () => string | null,
): FooterRowData[] {
  const activeBorderIds = new Set(
    Object.values(config.border_slots)
      .flat()
      .filter((id) => id !== "none"),
  );
  const renderRows = (
    layout: MinifooterConfig["footer_layout"],
    excludeNative: boolean,
  ): FooterRowData[] =>
    layout.map((row) => {
      const segments: FooterSegment[] = [];
      for (const item of row.items) {
        const id = typeof item === "string" ? item : item.id;
        if ((excludeNative && id === "native_footer") || activeBorderIds.has(id))
          continue;
        const seg = renderSegment(
          id,
          config,
          inputs,
          width,
          runPorcelain,
          typeof item === "string" ? undefined : item.showIcon,
        );
        if (seg !== null) segments.push(seg);
      }
      return {
        segments,
        separator: row.separator,
      };
    });
  return [
    ...renderRows(config.footer_layout, true),
    ...renderRows(config.native_footer_layout, false),
  ];
}

/** border_slots → 四角段(none → null) */
export function buildBorderSegments(
  config: MinifooterConfig,
  inputs: SegmentInputs,
  width: number,
  runPorcelain: () => string | null,
): Record<BorderSlotId, FooterSegment | null> {
  const out = {} as Record<BorderSlotId, FooterSegment | null>;
  for (const slot of [
    "top_left",
    "top_right",
    "bottom_left",
    "bottom_right",
  ] as const) {
    const ids = slotValues(config.border_slots[slot]);
    const rendered = ids
      .filter((id) => id !== "none")
      .map((id) => renderSegment(id, config, inputs, width, runPorcelain))
      .filter((segment): segment is FooterSegment => segment !== null);
    out[slot] =
      rendered.length === 0
        ? null
        : {
            ...rendered[0],
            text: rendered.map((segment) => segment.text).join(" "),
          };
  }
  return out;
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

interface RenderEnv {
  branchName: string | null;
  ctx: ExtensionContext;
  pi: Pick<ExtensionAPI, "exec" | "getThinkingLevel">;
  runtime: SessionRuntime;
}

/** Nordic footer 组件; render 前 mtime 热重载 */
class MiniFooter implements Component {
  private readonly env: RenderEnv;
  private readonly tui: TUI;
  private readonly unsub: () => void;
  private readonly footerData: ReadonlyFooterDataProvider;
  constructor(
    tui: TUI,
    private readonly theme: import("@earendil-works/pi-coding-agent").Theme,
    footerData: ReadonlyFooterDataProvider,
    env: RenderEnv,
  ) {
    this.tui = tui;
    this.env = env;
    this.footerData = footerData;
    this.unsub = footerData.onBranchChange(() => {
      env.branchName = footerData.getGitBranch();
      this.tui.requestRender();
    });
  }

  dispose(): void {
    this.unsub();
  }

  invalidate(): void {}

  render(width: number): string[] {
    this.env.runtime.maybeReload((msg) => this.env.ctx.ui.notify(msg, "warning"));
    this.env.branchName = this.footerData.getGitBranch();
    const inputs = collectInputs(
      this.env.pi,
      this.env.ctx,
      this.env.runtime,
      this.env.branchName,
      [
        ...this.footerData.getExtensionStatuses().entries(),
      ]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, text]) => text),
    );
    this.env.runtime.nativeStatuses = [
      ...inputs.nativeStatuses,
    ];
    const rows = buildFooterRows(this.env.runtime.config, inputs, width, () =>
      fetchPorcelain(this.env.pi, this.env.runtime, this.env.ctx.cwd),
    );
    return renderFooter(rows, this.env.runtime.config.density, width, this.theme);
  }
}

/** 在编辑器上下边框与内容之间插入可选的垂直留白 */
export function addEditorPadding(
  lines: string[],
  padding: MinifooterConfig["editor_padding"],
): string[] {
  if (lines.length < 3) return lines;
  if (padding === "relaxed") {
    return [
      lines[0] ?? "",
      "",
      ...lines.slice(1, -1),
      "",
      lines[lines.length - 1] ?? "",
    ];
  }
  return lines;
}
/** 编辑器四角边框; 只在槽位启用时安装 */
class BorderStatusEditor extends CustomEditor {
  private readonly env: RenderEnv;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    env: RenderEnv,
  ) {
    super(tui, theme, keybindings);
    this.env = env;
    env.runtime.activeTui = tui;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2) return lines;
    this.env.runtime.maybeReload((msg) => this.env.ctx.ui.notify(msg, "warning"));
    const inputs = collectInputs(
      this.env.pi,
      this.env.ctx,
      this.env.runtime,
      this.env.branchName,
    );
    const segs = buildBorderSegments(this.env.runtime.config, inputs, width, () =>
      fetchPorcelain(this.env.pi, this.env.runtime, this.env.ctx.cwd),
    );
    const thm = this.env.ctx.ui.theme;
    const color = (seg: FooterSegment | null): string =>
      seg === null ? "" : thm.fg(seg.colorToken ?? "muted", seg.text);
    lines[0] = renderBorderLine(
      color(segs.top_left),
      color(segs.top_right),
      width,
      thm,
      thinkingColorToken(inputs.thinkingLevel),
    );
    lines[lines.length - 1] = renderBorderLine(
      color(segs.bottom_left),
      color(segs.bottom_right),
      width,
      thm,
      thinkingColorToken(inputs.thinkingLevel),
    );
    return addEditorPadding(lines, this.env.runtime.config.editor_padding);
  }
}

// ─── SessionRuntime ─────────────────────────────────────────────────────────

function defaultStatMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** 会话级运行时: 配置 + mtime 热重载 + porcelain 缓存 */
export class SessionRuntime {
  config: MinifooterConfig = structuredClone(DEFAULT_CONFIG);
  editorInstalled = false;
  activeTui: TUI | null = null;
  startAt = 0;
  porcelain: {
    at: number;
    inflight: boolean;
    raw: string | null;
  } = {
    at: 0,
    inflight: false,
    raw: null,
  };
  private lastBadMtime: number | null = null;
  private mtime: number | null = null;
  private readonly deps: Required<RuntimeDeps>;
  private syncEditor: (() => void) | null = null;

  constructor(deps: RuntimeDeps = {}) {
    this.deps = {
      configPath: deps.configPath ?? configPath,
      loadConfig: deps.loadConfig ?? loadConfig,
      loadConfigWithError:
        deps.loadConfigWithError ??
        (deps.loadConfig
          ? (path) => {
              const loaded = deps.loadConfig?.(path) ?? null;
              return {
                error: loaded === null ? "invalid configuration" : null,
                loaded,
              };
            }
          : loadConfigWithError),
      now: deps.now ?? Date.now,
      statMtime: deps.statMtime ?? defaultStatMtime,
    };
  }

  /** mtime 热重载; 解析失败 keep-last-valid; 同一坏 mtime 只 notify 一次 */
  maybeReload(notify?: (msg: string) => void): boolean {
    const path = this.deps.configPath();
    const mtime = this.deps.statMtime(path);
    if (mtime === null) return false;
    if ((this.mtime !== null && mtime === this.mtime) || mtime === this.lastBadMtime) {
      return false;
    }
    const result = this.deps.loadConfigWithError(path);
    if (result.loaded === null) {
      this.lastBadMtime = mtime;
      const detail = result.error ? `: ${result.error}` : "";
      notify?.(
        `xpi-minifooter: invalid minifooter.yml${detail} — keeping last valid config`,
      );
      return false;
    }
    const loaded = result.loaded;
    this.config = loaded.config;
    this.mtime = mtime;
    this.lastBadMtime = null;
    this.syncEditor?.();
    return true;
  }

  /** panel 保存后直接落内存(同步 mtime, 外部编辑不重复加载) */
  applyConfig(config: MinifooterConfig): void {
    this.config = config;
    this.mtime = this.deps.statMtime(this.deps.configPath());
    this.lastBadMtime = null;
    this.syncEditor?.();
    this.activeTui?.requestRender();
  }

  setEditorSync(sync: () => void): void {
    this.syncEditor = sync;
  }
  nativeStatuses: string[] = [];
}

// ─── 接线入口 ────────────────────────────────────────────────────────────────

/** 任一槽位非 none → 安装 CustomEditor */
function slotsActive(config: MinifooterConfig): boolean {
  return shouldInstallEditor(config.border_slots);
}

/**
 * session 生命周期接线(4.1)。
 * 返回 cleanup(测试用); 生产中 Pi teardown 即结束。
 */
export function wireSession(pi: ExtensionAPI, runtime: SessionRuntime): void {
  pi.on("session_start", (_event: SessionStartEvent, ctx: ExtensionContext) => {
    runtime.startAt = Date.now();
    runtime.porcelain = {
      at: 0,
      inflight: false,
      raw: null,
    };

    // 1. 初次加载配置(坏文件 → 默认值 + 一次性 notify)
    runtime.maybeReload((msg) => ctx.ui.notify(msg, "warning"));

    const env: RenderEnv = {
      branchName: null,
      ctx,
      pi,
      runtime,
    };
    // 2. footer(无条件)
    ctx.ui.setFooter((tui, theme, footerData) => {
      env.branchName = footerData.getGitBranch();
      const footer = new MiniFooter(tui, theme, footerData, env);
      runtime.activeTui = tui;
      return footer;
    });

    // getGitBranch 在每次 footer 工厂调用时同步进 env; onBranchChange 触发组件重绘后由 MiniFooter.render 更新
    // 3. editor 边框(条件安装; 配置变化时同步安装/卸载)
    const editorFactory = (
      tui: TUI,
      theme: EditorTheme,
      keybindings: KeybindingsManager,
    ) => new BorderStatusEditor(tui, theme, keybindings, env);
    const syncEditor = (): void => {
      const active = slotsActive(runtime.config);
      if (active && !runtime.editorInstalled) {
        ctx.ui.setEditorComponent(editorFactory);
        runtime.editorInstalled = true;
      } else if (!active && runtime.editorInstalled) {
        ctx.ui.setEditorComponent(undefined);
        runtime.editorInstalled = false;
      }
    };
    syncEditor();
    runtime.setEditorSync(syncEditor);

    const requestRender = (): void => runtime.activeTui?.requestRender();
    // 4. agent 起止 → 全局重绘(分支变化由 footer 组件自订阅 onBranchChange)
    pi.on("agent_start", requestRender);
    pi.on("agent_settled", requestRender);
  });

  // 5. shutdown: 释放 porcelain 缓存与编辑器状态(footer dispose 由 Pi 调)
  pi.on("session_shutdown", () => {
    runtime.porcelain = {
      at: 0,
      inflight: false,
      raw: null,
    };
    runtime.editorInstalled = false;
    runtime.activeTui = null;
    runtime.startAt = 0;
  });
}
