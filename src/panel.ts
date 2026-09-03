/**
 * xpi-minifooter — /xpi-minifooter 配置面板 (task 4.2)
 *
 * Glimpse 主路径: dynamic import glimpseui, 失败 fail-closed 返回 "unavailable"
 * (TUI fallback 在 task 4.3 接线)。
 *
 * 面板 HTML 遵循 DESIGN.md tokens; 所有插值经 escapeHtml。
 * Save 发回 config 对象 → Node 端 parseConfig(JSON.stringify) 复用校验管线
 * (JSON 是合法 YAML 子集, fail-closed 一致)。
 */
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { MinifooterConfig } from "./config.js";
import { PARAMETER_IDS } from "./config.js";

export type PanelResult =
  | {
      outcome: "saved";
      config: MinifooterConfig;
    }
  | {
      outcome: "cancelled";
    }
  | {
      outcome: "unavailable";
    };

/** glimpseui loader(可注入 mock); 返回 null = 不可用 */
export type GlimpseLoader = () => Promise<GlimpseModule | null>;

export interface GlimpseModule {
  prompt(html: string, options?: Record<string, unknown>): Promise<unknown>;
}

async function tryImport(spec: string): Promise<GlimpseModule | null> {
  try {
    const mod = (await import(spec)) as {
      prompt?: unknown;
    };
    if (typeof mod.prompt === "function") return mod as GlimpseModule;
  } catch {
    // 尝试下一个 specifier
  }
  return null;
}

/** 顺序尝试两个 specifier; 全部失败 → null(fail-closed) */
export async function loadGlimpse(): Promise<GlimpseModule | null> {
  return (
    (await tryImport("glimpseui/src/glimpse.mjs")) ??
    (await tryImport(
      join(getAgentDir(), "npm", "node_modules", "glimpseui", "src", "glimpse.mjs"),
    ))
  );
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** footer_layout 对象 → textarea 用的 YAML 片段(逐行 items/separator) */
export function footerLayoutToText(layout: MinifooterConfig["footer_layout"]): string {
  return layout
    .map((row) => `- separator: ${row.separator}\n  items: [${row.items.join(", ")}]`)
    .join("\n");
}

// ─── HTML 生成(DESIGN.md tokens) ────────────────────────────────────────────

const TOKENS = {
  accent: "#4D9375",
  canvas: "#1E1E1E",
  error: "#F44747",
  ink: "#D4D4D4",
  muted: "#808080",
  "on-accent": "#FFFFFF",
  primary: "#3B82F6",
  rule: "#3C3C3C",
} as const;

function selectHtml(id: string, value: string, options: readonly string[]): string {
  const opts = options
    .map((o) => `<option value="${o}"${o === value ? " selected" : ""}>${o}</option>`)
    .join("");
  return `<select id="${id}">${opts}</select>`;
}

/** 面板 HTML; 所有插值经 escapeHtml 或来自受限枚举 */
export function buildPanelHtml(config: MinifooterConfig): string {
  const e = escapeHtml;
  const slotOptions = [
    "none",
    ...PARAMETER_IDS,
  ];
  const slots = config.border_slots;
  const footerText = e(footerLayoutToText(config.footer_layout));
  const t = config.thresholds;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    --canvas: ${TOKENS.canvas}; --ink: ${TOKENS.ink}; --muted: ${TOKENS.muted};
    --rule: ${TOKENS.rule}; --primary: ${TOKENS.primary}; --accent: ${TOKENS.accent};
    --on-accent: ${TOKENS["on-accent"]}; --error: ${TOKENS.error};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--canvas); color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px; line-height: 1.4; padding: 16px 20px;
  }
  h1 { font-size: 14px; font-weight: 700; margin: 0 0 12px; }
  h1 .hint { color: var(--muted); font-weight: 400; font-size: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  label { color: var(--muted); display: block; margin-bottom: 2px; }
  select, input[type="number"] {
    width: 100%; padding: 4px 6px; background: var(--canvas); color: var(--ink);
    border: 1px solid var(--rule); font: inherit;
  }
  select:focus, input:focus, textarea:focus { outline: none; border-color: var(--primary); }
  textarea {
    width: 100%; height: 84px; background: var(--canvas); color: var(--ink);
    border: 1px solid var(--rule); font: inherit; padding: 4px 6px; resize: vertical;
  }
  .checks { display: flex; gap: 16px; align-items: center; margin-top: 8px; }
  .checks label { display: flex; gap: 4px; align-items: center; color: var(--ink); margin: 0; }
  .section { margin-top: 14px; }
  .section > .title { color: var(--accent); margin-bottom: 6px; }
  #preview {
    border: 1px solid var(--rule); padding: 10px 12px; margin-top: 8px;
    white-space: pre; overflow-x: auto; min-height: 64px;
  }
  #preview .sep { color: var(--muted); }
  #layoutErr { color: var(--error); min-height: 16px; margin-top: 4px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
  button {
    padding: 8px 18px; font: inherit; cursor: pointer;
    border: 1px solid var(--rule); background: var(--canvas); color: var(--ink);
  }
  button.primary { background: var(--primary); border-color: var(--primary); color: var(--on-accent); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
<h1>xpi-minifooter <span class="hint">/minifooter.yml</span></h1>

<div class="grid">
  <div><label>lang</label>${selectHtml("lang", config.lang, [
    "zh",
    "en",
  ])}</div>
  <div><label>density</label>${selectHtml("density", config.density, [
    "compact",
    "comfortable",
    "spacious",
  ])}</div>
  <div><label>cwd_path_mode</label>${selectHtml("cwd_path_mode", config.cwd_path_mode, [
    "basename",
    "relative",
    "full",
  ])}</div>
  <div><label>git_branch_mode</label>${selectHtml(
    "git_branch_mode",
    config.git_branch_mode,
    [
      "mini",
      "default",
      "full",
    ],
  )}</div>
  <div><label>thresholds.context_warn (0-100)</label><input id="context_warn" type="number" min="0" max="100" value="${t.context_warn}"></div>
  <div><label>thresholds.context_alert (0-100)</label><input id="context_alert" type="number" min="0" max="100" value="${t.context_alert}"></div>
  <div><label>thresholds.context_danger (0-100)</label><input id="context_danger" type="number" min="0" max="100" value="${t.context_danger}"></div>
  <div class="checks">
    <label><input id="show_icons" type="checkbox" ${config.show_icons ? "checked" : ""}> show_icons</label>
    <label><input id="show_labels" type="checkbox" ${config.show_labels ? "checked" : ""}> show_labels</label>
  </div>
</div>

<div class="section">
  <div class="title">border_slots</div>
  <div class="grid">
    <div><label>top_left</label>${selectHtml("top_left", slots.top_left, slotOptions)}</div>
    <div><label>top_right</label>${selectHtml("top_right", slots.top_right, slotOptions)}</div>
    <div><label>bottom_left</label>${selectHtml("bottom_left", slots.bottom_left, slotOptions)}</div>
    <div><label>bottom_right</label>${selectHtml("bottom_right", slots.bottom_right, slotOptions)}</div>
  </div>
</div>

<div class="section">
  <div class="title">footer_layout <span style="color:var(--muted)">(YAML list)</span></div>
  <textarea id="footer_layout" spellcheck="false">${footerText}</textarea>
  <div id="layoutErr"></div>
</div>

<div class="section">
  <div class="title">preview</div>
  <div id="preview"></div>
</div>

<div class="actions">
  <button id="cancel" type="button">Cancel</button>
  <button id="save" type="button" class="primary">Save</button>
</div>

<script>
(function () {
  var SEPS = { slash: "/", dot: "·", pipe: "|", space: " " };
  var LAYOUT_KEYS = ["lang", "density", "cwd_path_mode", "git_branch_mode"];

  function val(id) { return document.getElementById(id).value; }
  function num(id) { return Number(val(id)); }
  function checked(id) { return document.getElementById(id).checked; }

  function parseLayout() {
    var raw = val("footer_layout");
    if (raw.trim() === "") return { rows: [], error: null };
    try {
      var parsed = jsyamlParse(raw);
      if (!Array.isArray(parsed)) return { rows: null, error: "footer_layout must be a list" };
      var rows = [];
      for (var i = 0; i < parsed.length; i++) {
        var row = parsed[i] || {};
        var items = row.items || [];
        if (!Array.isArray(items)) return { rows: null, error: "row " + (i + 1) + ": items must be a list" };
        rows.push({ separator: row.separator || "slash", items: items });
      }
      return { rows: rows, error: null };
    } catch (err) {
      return { rows: null, error: String(err && err.message || err) };
    }
  }

  // 受限 YAML 子集解析(仅 footer_layout 列表): - separator: x / items: [a, b]
  function jsyamlParse(raw) {
    var rows = [];
    var lines = raw.split("\\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim() === "") continue;
      var m = line.match(/^\\s*-\\s*separator:\\s*(\\S+)/);
      if (!m) throw new Error("line " + (i + 1) + ': expected "- separator: <sep>"');
      var row = { separator: m[1], items: [] };
      var rest = line.slice(line.indexOf(m[1]) + m[1].length);
      var im = rest.match(/items:\\s*\\[(.*)\\]/);
      if (im) {
        row.items = im[1].split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      }
      rows.push(row);
    }
    return rows;
  }

  function collect() {
    var layout = parseLayout();
    return {
      lang: val("lang"),
      density: val("density"),
      cwd_path_mode: val("cwd_path_mode"),
      git_branch_mode: val("git_branch_mode"),
      show_icons: checked("show_icons"),
      show_labels: checked("show_labels"),
      thresholds: {
        context_warn: num("context_warn"),
        context_alert: num("context_alert"),
        context_danger: num("context_danger"),
      },
      border_slots: {
        top_left: val("top_left"),
        top_right: val("top_right"),
        bottom_left: val("bottom_left"),
        bottom_right: val("bottom_right"),
      },
      footer_layout: layout.rows || [],
    };
  }

  function renderPreview() {
    var preview = document.getElementById("preview");
    var errEl = document.getElementById("layoutErr");
    var saveBtn = document.getElementById("save");
    var layout = parseLayout();
    if (layout.error) {
      errEl.textContent = layout.error;
      saveBtn.disabled = true;
      preview.textContent = "";
      return;
    }
    errEl.textContent = "";
    saveBtn.disabled = false;
    var lines = [];
    var slots = {
      top_left: val("top_left"), top_right: val("top_right"),
      bottom_left: val("bottom_left"), bottom_right: val("bottom_right"),
    };
    lines.push(slots.top_left + new Array(24).join(" ") + slots.top_right);
    lines.push("");
    for (var i = 0; i < layout.rows.length; i++) {
      var row = layout.rows[i];
      var sep = SEPS[row.separator] || "/";
      lines.push(row.items.join(" " + sep + " "));
    }
    lines.push("");
    lines.push(slots.bottom_left + new Array(24).join(" ") + slots.bottom_right);
    preview.textContent = lines.join("\\n");
  }

  LAYOUT_KEYS.forEach(function (id) {
    document.getElementById(id).addEventListener("change", renderPreview);
  });
  ["context_warn", "context_alert", "context_danger",
   "show_icons", "show_labels", "top_left", "top_right",
   "bottom_left", "bottom_right"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", renderPreview);
  });
  document.getElementById("footer_layout").addEventListener("input", renderPreview);

  document.getElementById("save").addEventListener("click", function () {
    window.glimpse.send({ action: "save", config: collect() });
  });
  document.getElementById("cancel").addEventListener("click", function () {
    window.glimpse.send(null);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") window.glimpse.send(null);
  });

  renderPreview();
})();
</script>
</body>
</html>`;
}

export interface PanelDeps {
  load?: GlimpseLoader;
}

/**
 * 打开 Glimpse 面板。
 * - saved: 用户确认, config 已收
 * - cancelled: 窗口关闭 / Esc / Cancel
 * - unavailable: glimpseui 动态导入失败(fail-closed, 调用方走 TUI fallback)
 */
export async function openGlimpsePanel(
  config: MinifooterConfig,
  deps: PanelDeps = {},
): Promise<PanelResult> {
  const load = deps.load ?? loadGlimpse;
  let glimpse: GlimpseModule | null;
  try {
    glimpse = await load();
  } catch {
    return {
      outcome: "unavailable",
    };
  }
  if (glimpse === null)
    return {
      outcome: "unavailable",
    };
  const answer = (await glimpse.prompt(buildPanelHtml(config), {
    height: 720,
    title: "xpi-minifooter",
    width: 640,
  })) as {
    action?: string;
    config?: unknown;
  } | null;
  if (
    answer === null ||
    answer === undefined ||
    answer.action !== "save" ||
    typeof answer.config !== "object" ||
    answer.config === null
  ) {
    return {
      outcome: "cancelled",
    };
  }
  return {
    config: answer.config as MinifooterConfig,
    outcome: "saved",
  };
}
