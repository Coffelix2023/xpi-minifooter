/**
 * xpi-minifooter — /xpi-minifooter 配置面板
 *
 * Glimpse 主路径: dynamic import glimpseui, 失败 fail-closed 返回 "unavailable"。
 * 面板提供 Form 与 YAML Source 两个 Tab，保存结果统一交给 Node 端严格校验管线。
 *
 * 面板 HTML 遵循 DESIGN.md tokens; 所有动态文本经 escapeHtml。
 */
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parse as parseYaml } from "yaml";
import { type MinifooterConfig, PARAMETER_IDS, serializeConfig } from "./config.js";

const ERROR_LINE_PATTERN = /line (\d+)/i;

export type PanelResult =
  | {
      outcome: "saved";
      config: MinifooterConfig;
    }
  | {
      outcome: "saved";
      rawYaml: string;
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

export interface FooterLayoutParseResult {
  error: string | null;
  rows: MinifooterConfig["footer_layout"] | null;
}

/** 解析面板 textarea 的标准 YAML footer_layout，并保留真实行号。 */
export function parseFooterLayoutText(raw: string): FooterLayoutParseResult {
  try {
    const parsed = parseYaml(raw) as unknown;
    if (!Array.isArray(parsed))
      return {
        error: "footer_layout must be a list",
        rows: null,
      };
    const rows = parsed.map((value, index) => {
      if (typeof value !== "object" || value === null)
        throw new Error(`row ${index + 1}: must be an object`);
      const row = value as {
        items?: unknown;
        separator?: unknown;
      };
      if (!Array.isArray(row.items))
        throw new Error(`row ${index + 1}: items must be a list`);
      if (row.separator !== undefined && typeof row.separator !== "string") {
        throw new Error(`row ${index + 1}: separator must be text`);
      }
      return {
        items: row.items.filter(
          (item): item is MinifooterConfig["footer_layout"][number]["items"][number] =>
            typeof item === "string" &&
            PARAMETER_IDS.includes(item as (typeof PARAMETER_IDS)[number]),
        ),
        separator: (row.separator ??
          "slash") as MinifooterConfig["footer_layout"][number]["separator"],
      };
    });
    return {
      rows,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const line = ERROR_LINE_PATTERN.exec(message)?.[1];
    return {
      error: line ? message : `line 1: ${message}`,
      rows: null,
    };
  }
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

const PARAMETER_DESCRIPTIONS: Record<(typeof PARAMETER_IDS)[number], string> = {
  context_bar: "context usage bar and percent",
  context_compact: "compact context percent",
  cost: "session cost in USD",
  cwd_path: "current working directory",
  git_branch: "branch and worktree status",
  mcp_skills: "MCP server and skill counts",
  model_id: "active model raw id",
  model_name: "active model friendly name or id",
  native_footer: "native footer extension status indicators",
  provider: "active model provider",
  session_time: "elapsed session time",
  thinking_mode: "current thinking level",
  tokens: "input and output token counts",
};

function parameterDescription(id: (typeof PARAMETER_IDS)[number]): string {
  return PARAMETER_DESCRIPTIONS[id];
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
  const sourceText = e(serializeConfig(config));
  const t = config.thresholds;
  const reference = PARAMETER_IDS.map(
    (id) =>
      `<div class="ref-row"><code>${id}</code><span>${parameterDescription(id)}</span></div>`,
  ).join("");
  const legalValues = [
    "lang: zh | en",
    "style: minimalist",
    "density: compact | comfortable | spacious",
    "editor_padding: default | compact | relaxed",
    "git_branch_mode: mini | default | full",
    "cwd_path_mode: basename | relative | full",
    "separator: slash | dot | pipe | space",
  ].join(" · ");
  const select = (id: string, value: string, options: readonly string[]) =>
    selectHtml(id, value, options);
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
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 12px; }
  .tab { padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
  .tab.active { color: var(--ink); border-bottom-color: var(--primary); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  label { color: var(--muted); display: block; margin-bottom: 2px; }
  select, input[type="number"] {
    width: 100%; padding: 4px 6px; background: var(--canvas); color: var(--ink);
    border: 1px solid var(--rule); font: inherit;
  }
  select:focus, input:focus, textarea:focus { outline: none; border-color: var(--primary); }
  textarea {
    width: 100%; height: 104px; background: var(--canvas); color: var(--ink);
    border: 1px solid var(--rule); font: inherit; padding: 4px 6px; resize: vertical;
  }
  #yaml_source { height: 300px; }
  .checks { display: flex; gap: 16px; align-items: center; margin-top: 8px; }
  .checks label { display: flex; gap: 4px; align-items: center; color: var(--ink); margin: 0; }
  .section { margin-top: 14px; }
  .section > .title { color: var(--accent); margin-bottom: 6px; }
  #preview, #sourcePreview {
    border: 1px solid var(--rule); padding: 10px 12px; margin-top: 8px;
    white-space: pre; overflow-x: auto; min-height: 64px;
  }
  #layoutErr, #sourceErr { color: var(--error); min-height: 16px; margin-top: 4px; }
  #occupancy { color: var(--muted); margin-top: 6px; white-space: normal; }
  .ref { border: 1px solid var(--rule); padding: 6px 8px; }
  .ref-row { display: grid; grid-template-columns: 18ch 1fr; gap: 8px; padding: 2px 0; }
  .ref-row code { color: var(--accent); }
  .legal { color: var(--muted); margin-top: 6px; white-space: normal; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
  button {
    padding: 8px 18px; font: inherit; cursor: pointer;
    border: 1px solid var(--rule); background: var(--canvas); color: var(--ink);
  }
  button.primary { background: var(--primary); border-color: var(--primary); color: var(--on-accent); }
  button.secondary { padding: 4px 8px; color: var(--muted); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
<h1>xpi-minifooter <span class="hint">/minifooter.yml</span></h1>
<div class="tabs" role="tablist">
  <button class="tab active" id="formTabButton" type="button" data-tab="formTab">Form</button>
  <button class="tab" id="sourceTabButton" type="button" data-tab="sourceTab">YAML Source</button>
</div>
<div id="formTab" class="tab-panel active">
  <div class="grid">
    <div><label>lang</label>${select("lang", config.lang, [
      "zh",
      "en",
    ])}</div>
    <div><label>style</label>${select("style", config.style, [
      "minimalist",
    ])}</div>
    <div><label>density</label>${select("density", config.density, [
      "compact",
      "comfortable",
      "spacious",
    ])}</div>
    <div><label>editor_padding</label>${select(
      "editor_padding",
      config.editor_padding,
      [
        "default",
        "compact",
        "relaxed",
      ],
    )}</div>
    <div><label>cwd_path_mode</label>${select("cwd_path_mode", config.cwd_path_mode, [
      "basename",
      "relative",
      "full",
    ])}</div>
    <div><label>git_branch_mode</label>${select(
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
      <div><label>top_left</label>${select("top_left", slots.top_left, slotOptions)}</div>
      <div><label>top_right</label>${select("top_right", slots.top_right, slotOptions)}</div>
      <div><label>bottom_left</label>${select("bottom_left", slots.bottom_left, slotOptions)}</div>
      <div><label>bottom_right</label>${select("bottom_right", slots.bottom_right, slotOptions)}</div>
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
    <div id="occupancy"></div>
  </div>
</div>
<div id="sourceTab" class="tab-panel">
  <div class="section" style="margin-top:0">
    <div class="title">complete minifooter.yml</div>
    <textarea id="yaml_source" spellcheck="false">${sourceText}</textarea>
    <div id="sourceErr"></div>
    <button id="insertTemplate" class="secondary" type="button">Insert template</button>
  </div>
  <div class="section">
    <div class="title">${PARAMETER_IDS.length}-parameter reference</div>
    <div class="ref">${reference}</div>
    <div class="legal">${e(legalValues)}</div>
  </div>
  <div class="section">
    <div class="title">source preview</div>
    <div id="sourcePreview"></div>
  </div>
</div>
<div class="actions">
  <button id="cancel" type="button">Cancel</button>
  <button id="save" type="button" class="primary">Save</button>
</div>
<script>
(function () {
  var SEPS = { slash: "/", dot: "·", pipe: "|", space: " " };
  var TEMPLATE = ${JSON.stringify(serializeConfig(config))};
  var PARAMETER_IDS = ${JSON.stringify(PARAMETER_IDS)};
  var activeTab = "formTab";
  function el(id) { return document.getElementById(id); }
  function val(id) { return el(id).value; }
  function num(id) { return Number(val(id)); }
  function checked(id) { return el(id).checked; }
  function occupied() {
    var slots = [val("top_left"), val("top_right"), val("bottom_left"), val("bottom_right")];
    var set = {};
    slots.forEach(function (id) { if (id && id !== "none") set[id] = true; });
    return set;
  }
  function parseLayout(raw) {
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
  function jsyamlParse(raw) {
    var rows = [];
    var lines = raw.split("\\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim() === "") continue;
      var m = line.match(/^\\s*-\\s*separator:\\s*(\\S+)(?:\\s*,\\s*items:\\s*\\[(.*)\\])?\\s*$/);
      if (m) {
        var row = { separator: m[1], items: [] };
        if (m[2] !== undefined) row.items = m[2].split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        rows.push(row);
        continue;
      }
      var continuation = line.match(/^\\s+items:\\s*\\[(.*)\\]\\s*$/);
      if (continuation && rows.length > 0) {
        rows[rows.length - 1].items = continuation[1].split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        continue;
      }
      throw new Error("line " + (i + 1) + ': expected "- separator: <sep>" or indented items');
    }
    return rows;
  }
  function parseSource(raw) {
    var result = { border_slots: {}, footer_layout: null };
    var section = null;
    var footerLines = [];
    raw.split("\\n").forEach(function (line) {
      var trimmed = line.trim();
      if (trimmed === "" || trimmed.charAt(0) === "#") return;
      var top = line.match(/^([A-Za-z_]+):\\s*(.*)$/);
      var nested = line.match(/^\\s+([A-Za-z_]+):\\s*(.*)$/);
      if (top) {
        section = top[1];
        if (section === "footer_layout") footerLines = [];
        else if (top[2] !== "") result[section] = scalar(top[2]);
        return;
      }
      if (section === "footer_layout") { footerLines.push(line); return; }
      if (nested && (section === "border_slots" || section === "thresholds")) {
        if (!result[section] || typeof result[section] !== "object") result[section] = {};
        result[section][nested[1]] = scalar(nested[2]);
      }
    });
    if (footerLines.length > 0) result.footer_layout = parseLayout(footerLines.join("\\n")).rows;
    return result;
  }
  function scalar(value) {
    var text = value.trim();
    if (text === "true") return true;
    if (text === "false") return false;
    if (/^-?\\d+(?:\\.\\d+)?$/.test(text)) return Number(text);
    if ((text.charAt(0) === String.fromCharCode(34) && text.charAt(text.length - 1) === String.fromCharCode(34)) || (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'")) return text.slice(1, -1);
    return text;
  }
  function effectiveRows(rows, slots) {
    return (rows || []).map(function (row) {
      return { separator: row.separator || "slash", items: (row.items || []).filter(function (id) { return PARAMETER_IDS.indexOf(id) >= 0 && !slots[id]; }) };
    });
  }
  function previewText(rows, slots) {
    var occupiedIds = {};
    Object.keys(slots || {}).forEach(function (key) {
      var id = slots[key];
      if (id && id !== "none") occupiedIds[id] = true;
    });
    var lines = [];
    var topLeft = slots.top_left === "none" ? "" : (slots.top_left || "");
    var topRight = slots.top_right === "none" ? "" : (slots.top_right || "");
    var bottomLeft = slots.bottom_left === "none" ? "" : (slots.bottom_left || "");
    var bottomRight = slots.bottom_right === "none" ? "" : (slots.bottom_right || "");
    lines.push(topLeft + new Array(24).join(" ") + topRight);
    lines.push("");
    effectiveRows(rows, occupiedIds).forEach(function (row) {
      var sep = SEPS[row.separator] || "/";
      if (row.items.length > 0) lines.push(row.items.join(" " + sep + " "));
    });
    lines.push("");
    lines.push(bottomLeft + new Array(24).join(" ") + bottomRight);
    return lines.join("\\n");
  }
  function slotValues() { return { top_left: val("top_left"), top_right: val("top_right"), bottom_left: val("bottom_left"), bottom_right: val("bottom_right") }; }
  function renderPreview() {
    var layout = parseLayout(val("footer_layout"));
    var err = el("layoutErr");
    var save = el("save");
    if (layout.error) { err.textContent = layout.error; save.disabled = true; el("preview").textContent = ""; return; }
    err.textContent = "";
    save.disabled = false;
    var slots = slotValues();
    el("preview").textContent = previewText(layout.rows, occupied());
    var used = Object.keys(occupied());
    el("occupancy").textContent = used.length ? "Embedded in border: " + used.join(", ") + ". Footer duplicates hidden." : "No parameters embedded in border.";
  }
  function renderSourcePreview() {
    var parsed = parseSource(val("yaml_source"));
    var rawSlots = parsed.border_slots || {};
    var slots = {};
    Object.keys(rawSlots).forEach(function (key) {
      var id = rawSlots[key];
      if (id && id !== "none") slots[id] = true;
    });
    var rows = parsed.footer_layout || [];
    el("sourcePreview").textContent = previewText(rows, slots);
    el("sourceErr").textContent = parsed.footer_layout === null ? "Source preview is partial until valid footer_layout YAML is entered." : "";
  }
  function switchTab(tab) {
    activeTab = tab;
    ["formTab", "sourceTab"].forEach(function (id) { el(id).classList.toggle("active", id === tab); });
    ["formTabButton", "sourceTabButton"].forEach(function (id) { el(id).classList.toggle("active", el(id).getAttribute("data-tab") === tab); });
    if (tab === "sourceTab") renderSourcePreview();
  }
  ["formTabButton", "sourceTabButton"].forEach(function (id) { el(id).addEventListener("click", function () { switchTab(el(id).getAttribute("data-tab")); }); });
  ["lang", "style", "density", "editor_padding", "cwd_path_mode", "git_branch_mode"].forEach(function (id) { el(id).addEventListener("change", renderPreview); });
  ["context_warn", "context_alert", "context_danger", "show_icons", "show_labels", "top_left", "top_right", "bottom_left", "bottom_right"].forEach(function (id) { el(id).addEventListener("input", renderPreview); });
  el("footer_layout").addEventListener("input", renderPreview);
  el("yaml_source").addEventListener("input", renderSourcePreview);
  el("insertTemplate").addEventListener("click", function () { el("yaml_source").value = TEMPLATE; renderSourcePreview(); el("yaml_source").focus(); });
  function closePanel() {
    if (window.glimpse && typeof window.glimpse.close === "function") window.glimpse.close();
  }
  el("save").addEventListener("click", function () {
    if (!window.glimpse || typeof window.glimpse.send !== "function") return;
    if (activeTab === "sourceTab") window.glimpse.send({ action: "save", rawYaml: val("yaml_source") });
    else window.glimpse.send({ action: "save", config: collect() });
  });
  function collect() {
    var layout = parseLayout(val("footer_layout"));
    return {
      lang: val("lang"), style: val("style"), density: val("density"), editor_padding: val("editor_padding"),
      cwd_path_mode: val("cwd_path_mode"), git_branch_mode: val("git_branch_mode"),
      show_icons: checked("show_icons"), show_labels: checked("show_labels"),
      thresholds: { context_warn: num("context_warn"), context_alert: num("context_alert"), context_danger: num("context_danger") },
      border_slots: { top_left: val("top_left"), top_right: val("top_right"), bottom_left: val("bottom_left"), bottom_right: val("bottom_right") },
      footer_layout: layout.rows || [],
    };
  }
  el("cancel").addEventListener("click", closePanel);
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") closePanel(); });
  renderPreview();
  renderSourcePreview();
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
    rawYaml?: unknown;
  } | null;
  if (
    answer === null ||
    answer === undefined ||
    answer.action !== "save" ||
    (typeof answer.config !== "object" && typeof answer.rawYaml !== "string") ||
    (answer.config === null && typeof answer.rawYaml !== "string")
  ) {
    return {
      outcome: "cancelled",
    };
  }
  if (typeof answer.rawYaml === "string") {
    return {
      outcome: "saved",
      rawYaml: answer.rawYaml,
    };
  }
  return {
    config: answer.config as MinifooterConfig,
    outcome: "saved",
  };
}
