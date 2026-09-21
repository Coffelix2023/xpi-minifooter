import { Script } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG, type MinifooterConfig } from "../src/config.js";
import { applyPanelConfig, runMinifooterCommand } from "../src/index.js";
import {
  buildPanelHtml,
  escapeHtml,
  footerLayoutToText,
  type GlimpseModule,
  type GlimpseWindow,
  openGlimpsePanel,
  parseFooterLayoutText,
  type SavedPanelResult,
} from "../src/panel.js";
import { SessionRuntime } from "../src/session.js";

const PANEL_SCRIPT_PATTERN = /<script>\n([\s\S]*?)\n<\/script>/;
function assertPanelScriptIsValid(html: string): void {
  const script = html.match(PANEL_SCRIPT_PATTERN)?.[1];
  expect(script).toBeDefined();
  expect(() => new Script(script ?? "")).not.toThrow();
}

const INVALID_YAML_LINE_PATTERN = /xpi-minifooter: invalid YAML at line 1\n/;
function enConfig(): MinifooterConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    lang: "en",
  };
}

describe("buildPanelHtml", () => {
  test("generates executable panel event-handler script", () => {
    assertPanelScriptIsValid(
      buildPanelHtml(enConfig(), {
        liveApply: true,
      }),
    );
  });

  test("renders every field from DEFAULT_CONFIG", () => {
    const html = buildPanelHtml(DEFAULT_CONFIG);
    expect(html).toContain('id="lang"');
    expect(html).toContain('id="density"');
    expect(html).toContain('id="cwd_path_mode"');
    expect(html).toContain('id="git_branch_mode"');
    expect(html).toContain('id="show_icons"');
    expect(html).toContain('id="show_labels"');
    expect(html).toContain('id="context_warn"');
    expect(html).toContain('id="context_alert"');
    expect(html).toContain('id="context_danger"');
    expect(html).toContain('id="cost_currency"');
    expect(html).toContain('id="usage_detail"');
    expect(html).toContain('id="usd_to_cny_rate"');
    // collect() 必须把三者带回 Node 端校验
    expect(html).toContain("cost_currency: val('cost_currency')");
    expect(html).toContain("usage_detail: val('usage_detail')");
    expect(html).toContain("usd_to_cny_rate: num('usd_to_cny_rate')");
    for (const slot of [
      "top_left",
      "top_right",
      "bottom_left",
      "bottom_right",
    ]) {
      expect(html).toContain(`id="${slot}_1"`);
      expect(html).toContain(`id="${slot}_2"`);
    }
    expect(html).toContain('id="layoutRows"');
    expect(html).toContain('id="addRow"');
    expect(html).toContain('id="preview"');
  });

  test("renders none for both border positions and independent icon controls", () => {
    const html = buildPanelHtml({
      ...structuredClone(DEFAULT_CONFIG),
      border_slots: {
        ...structuredClone(DEFAULT_CONFIG.border_slots),
        top_left: [
          {
            id: "git_branch",
            showIcon: false,
          },
          {
            id: "model_name",
            showIcon: true,
          },
        ],
      },
    });
    for (const slot of [
      "top_left",
      "top_right",
      "bottom_left",
      "bottom_right",
    ]) {
      expect(html).toContain(`id="${slot}_1_show_icon"`);
      expect(html).toContain(`id="${slot}_2_show_icon"`);
    }
    expect(html.match(/<option value="none"/g)).toHaveLength(8);
    expect(html).toContain("function readBorderSlot(slot)");
    expect(html).toContain("showIcon: checked(slot + '_' + index + '_show_icon')");
  });

  test("provides bounded local font size controls", () => {
    const html = buildPanelHtml(enConfig());
    expect(html).toContain('id="fontSizeDown"');
    expect(html).toContain('id="fontSizeUp"');
    expect(html).toContain('id="fontSizeValue"');
    expect(html).toContain("--panel-font-size: 12px");
    expect(html).toContain("var MIN_FONT_SIZE = 10");
    expect(html).toContain("var MAX_FONT_SIZE = 16");
    expect(html).toContain("el('fontSizeDown').disabled = FONT_SIZE <= MIN_FONT_SIZE");
    expect(html).toContain("el('fontSizeUp').disabled = FONT_SIZE >= MAX_FONT_SIZE");
    expect(html).toContain("@media (max-width: 520px)");
    expect(html).not.toContain("font_size");
  });

  test("docks the action bar to the window bottom", () => {
    const html = buildPanelHtml(enConfig());
    expect(html).toContain(
      ".actions { display: flex; gap: 8px; justify-content: flex-end; position: fixed; bottom: 0; left: 0; right: 0;",
    );
    expect(html).toContain("padding: 16px 20px 64px");
    expect(html).toContain(
      '<button id="cancel" type="button" data-i18n="cancel">Cancel</button>',
    );
    expect(html).toContain(
      '<button id="save" type="button" class="primary" data-i18n="save">Save</button>',
    );
  });

  test("shows Apply only when liveApply is enabled", () => {
    expect(buildPanelHtml(enConfig())).not.toContain('<button id="apply"');
    expect(
      buildPanelHtml(enConfig(), {
        liveApply: true,
      }),
    ).toContain('<button id="apply" type="button" data-i18n="apply">Apply</button>');
  });

  test("removes legacy labels and icons sections", () => {
    const html = buildPanelHtml(DEFAULT_CONFIG);
    expect(html).not.toContain('<div class="title">icons</div>');
    expect(html).not.toContain('<div class="title">labels</div>');
    expect(html).not.toContain('id="native_footer"');
    expect(html).toContain('id="nativeLayoutRows"');
    expect(html).toContain("var nativeLayoutRows = []");
    expect(html).toContain("function renderLayoutRows(rows, wrapId, native)");
  });
  test("embeds both languages and refreshes marked content on lang change", () => {
    const html = buildPanelHtml(enConfig(), {
      liveApply: true,
    });
    expect(html).toContain('var PANEL_TEXT = {"en"');
    expect(html).toContain('data-i18n="apply"');
    expect(html).toContain('data-param-description="context_bar"');
    expect(html).toContain('el("lang").addEventListener("change", refreshLanguage)');
    expect(html).toContain("node.textContent = text.panelLabels.parameterReference");
    expect(html).toContain("token 数量;usage_detail 可追加缓存读写");
    expect(html).toContain("会话费用(货币由 cost_currency 决定");
  });

  test("shows in-panel Apply feedback without closing the window", () => {
    const html = buildPanelHtml(enConfig(), {
      liveApply: true,
    });
    expect(html).toContain('id="feedback"');
    expect(html).toContain('type === "apply-result"');
    expect(html).toContain('window.addEventListener("message"');
  });

  test("renders showIcon controls and native footer layout editor", () => {
    const html = buildPanelHtml({
      ...structuredClone(DEFAULT_CONFIG),
      footer_layout: [
        {
          separator: "slash",
          items: [
            {
              id: "git_branch",
              showIcon: false,
            },
          ],
        },
      ],
      native_footer_layout: [
        {
          separator: "dot",
          items: [
            "native_footer",
          ],
        },
      ],
    });
    expect(html).toContain("data-show-icon");
    expect(html).toContain("> showIcon</label>");
    expect(html).toContain('id="nativeLayoutRows"');
    expect(html).toContain("native_footer_layout: readLayout(nativeLayoutRows)");
  });

  test("renders native footer status and layout editor", () => {
    const html = buildPanelHtml(enConfig(), {
      nativeStatuses: [
        {
          key: "plugin",
          text: "● plugin:on",
        },
      ],
    });
    expect(html).toContain('id="nativeLayoutRows"');
    expect(html).toContain('id="nativeStatusList"');
    expect(html).toContain('id="nativeOverflow"');
    expect(html).toContain(
      'var NATIVE_STATUSES = [{"key":"plugin","text":"● plugin:on"}]',
    );
    expect(html).toContain("var NATIVE_HIDDEN = []");
  });
  test("escapes interpolated config values", () => {
    const html = buildPanelHtml(DEFAULT_CONFIG);
    // footer_layout 内容经 escapeHtml(默认值无特殊字符, 但断言无原始 <script> 注入面)
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  test("escapeHtml covers the five dangerous characters", () => {
    expect(escapeHtml(`<img src=x onerror="alert('a')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;a&#39;)&quot;&gt;&amp;",
    );
  });

  test("footerLayoutToText round-trips rows", () => {
    const text = footerLayoutToText(DEFAULT_CONFIG.footer_layout);
    expect(text).toBe(
      "- separator: slash\n  items: [git_branch, cwd_path, model_name, thinking_mode]\n- separator: slash\n  items: [context_bar, tokens, cost, session_time]",
    );
  });
  test("footerLayoutToText preserves showIcon object items", () => {
    const layout: MinifooterConfig["footer_layout"] = [
      {
        separator: "dot",
        items: [
          {
            id: "model_name",
            showIcon: false,
          },
          "tokens",
        ],
      },
    ];
    expect(parseFooterLayoutText(footerLayoutToText(layout)).rows).toEqual(layout);
  });
});

describe("footer layout parser", () => {
  test("accepts indented multi-line rows", () => {
    expect(
      parseFooterLayoutText("- separator: slash\n  items: [git_branch, cwd_path]"),
    ).toEqual({
      error: null,
      rows: [
        {
          separator: "slash",
          items: [
            "git_branch",
            "cwd_path",
          ],
        },
      ],
    });
  });

  test("round-trips serialized rows", () => {
    const layout = [
      {
        separator: "dot" as const,
        items: [
          "model_name" as const,
          "tokens" as const,
        ],
      },
    ];
    expect(parseFooterLayoutText(footerLayoutToText(layout)).rows).toEqual(layout);
  });

  test("reports the source line for malformed YAML", () => {
    const result = parseFooterLayoutText("- separator: slash\n  items: [git_branch");
    expect(result.error).toContain("line 2");
  });
});

describe("panel command config refresh", () => {
  test("refreshes runtime before panel state is read", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.density = "spacious";
    const runtime = {
      config: structuredClone(DEFAULT_CONFIG),
      maybeReload: (_notify?: (message: string) => void) => {
        runtime.config = config;
        return true;
      },
    };
    const { refreshConfigBeforePanel } = await import("../src/index.js");
    refreshConfigBeforePanel(runtime, () => {});
    expect(runtime.config.density).toBe("spacious");
  });

  test("Apply reports validation failures to stderr without stale UI access", async () => {
    const applied: unknown[] = [];
    const saved: unknown[] = [];
    const notifications: string[] = [];
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const runtime = new SessionRuntime({
      configPath: () => "/nonexistent/minifooter.yml",
      statMtime: () => null,
    });
    runtime.applyConfig = (config) => {
      applied.push(config);
    };
    await runMinifooterCommand(
      runtime,
      {
        ui: {
          notify: (message) => notifications.push(message),
        },
      },
      {
        openPanel: async (_config, deps) => {
          deps?.onApply?.({
            outcome: "saved",
            rawYaml: "density: compact",
          });
          deps?.onApply?.({
            outcome: "saved",
            rawYaml: "density: [",
          });
          return {
            outcome: "cancelled",
          };
        },
        save: {
          path: "/tmp/minifooter.yml",
          save: (_path, value) => saved.push(value),
        },
      },
    );
    const stderrCalls = stderrWrite.mock.calls.map(([message]) => message);
    stderrWrite.mockRestore();
    expect(saved).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      density: "compact",
    });
    expect(notifications).toEqual([]);
    expect(stderrCalls).toContainEqual(
      expect.stringMatching(INVALID_YAML_LINE_PATTERN),
    );
  });

  test("Save still applies once after the panel closes", async () => {
    const saved: unknown[] = [];
    const runtime = new SessionRuntime();
    await runMinifooterCommand(
      runtime,
      {
        ui: {
          notify: () => {},
        },
      },
      {
        openPanel: async () =>
          ({
            outcome: "saved",
            rawYaml: "density: compact",
          }) satisfies SavedPanelResult,
        save: {
          path: "/tmp/minifooter.yml",
          save: (_path, value) => saved.push(value),
        },
      },
    );
    expect(saved).toHaveLength(1);
    expect(runtime.config.density).toBe("compact");
  });
});
describe("panel save boundary", () => {
  test("applies valid form config through one boundary", () => {
    const applied: unknown[] = [];
    const saved: unknown[] = [];
    const runtime = {
      applyConfig: (config: unknown) => applied.push(config),
    };
    const config = structuredClone(DEFAULT_CONFIG);
    config.density = "compact";
    const result = applyPanelConfig(
      runtime,
      {
        config,
        outcome: "saved",
      },
      () => {},
      {
        path: "/tmp/minifooter.yml",
        save: (_path, value) => saved.push(value),
      },
    );
    expect(result).toBe(true);
    expect(applied[0]).toMatchObject({
      density: "compact",
    });
    expect(saved[0]).toMatchObject({
      density: "compact",
    });
  });

  test("applies valid raw YAML through the same boundary", () => {
    const applied: unknown[] = [];
    const runtime = {
      applyConfig: (config: unknown) => applied.push(config),
    };
    const result = applyPanelConfig(
      runtime,
      {
        outcome: "saved",
        rawYaml: "density: compact",
      },
      () => {},
      {
        path: "/tmp/minifooter.yml",
        save: () => {},
      },
    );
    expect(result).toBe(true);
    expect(applied[0]).toMatchObject({
      density: "compact",
    });
  });

  test("persists native footer capacity through the save boundary", () => {
    const applied: MinifooterConfig[] = [];
    const saved: MinifooterConfig[] = [];
    const runtime = {
      applyConfig: (config: MinifooterConfig) => applied.push(config),
    };
    const config = structuredClone(DEFAULT_CONFIG);
    config.footer_layout = [];
    config.native_footer_layout = [
      {
        separator: "space",
        items: [
          {
            id: "native_footer",
            max: 5,
          },
        ],
      },
    ];
    config.native_status = {
      hidden: [
        "rtk",
      ],
    };
    const result = applyPanelConfig(
      runtime,
      {
        config,
        outcome: "saved",
      },
      () => {},
      {
        path: "/tmp/minifooter.yml",
        save: (_path, value) => saved.push(value),
      },
    );
    expect(result).toBe(true);
    expect(applied[0]?.native_footer_layout[0]?.items[0]).toEqual({
      id: "native_footer",
      max: 5,
    });
    expect(saved[0]?.native_status).toEqual({
      hidden: [
        "rtk",
      ],
    });
  });

  test("reports validation and save failures to the panel responder", () => {
    const feedback: {
      ok: boolean;
      message: string;
    }[] = [];
    const invalid = structuredClone(DEFAULT_CONFIG);
    invalid.density = "invalid" as never;
    expect(
      applyPanelConfig(
        {
          applyConfig: () => {},
        },
        {
          config: invalid,
          outcome: "saved",
        },
        () => {},
        {
          path: "/tmp/minifooter.yml",
          save: () => {},
        },
        (message) => feedback.push(message),
      ),
    ).toBe(false);
    expect(feedback[0]?.ok).toBe(false);

    expect(
      applyPanelConfig(
        {
          applyConfig: () => {},
        },
        {
          config: DEFAULT_CONFIG,
          outcome: "saved",
        },
        () => {},
        {
          path: "/tmp/minifooter.yml",
          save: () => {
            throw new Error("disk full");
          },
        },
        (message) => feedback.push(message),
      ),
    ).toBe(false);
    expect(feedback[1]?.ok).toBe(false);
  });

  test("invalid form config is visible and does not save or apply", () => {
    const notifications: string[] = [];
    let saveCalls = 0;
    let applyCalls = 0;
    const config = structuredClone(DEFAULT_CONFIG);
    config.density = "invalid" as never;
    const result = applyPanelConfig(
      {
        applyConfig: () => {
          applyCalls += 1;
        },
      },
      {
        config,
        outcome: "saved",
      },
      (message) => notifications.push(message),
      {
        path: "/tmp/minifooter.yml",
        save: () => {
          saveCalls += 1;
        },
      },
    );
    expect(result).toBe(false);
    expect(saveCalls).toBe(0);
    expect(applyCalls).toBe(0);
    expect(notifications[0]).toContain("invalid");
  });

  test("invalid raw YAML reports a source line and does not save", () => {
    const notifications: string[] = [];
    let saveCalls = 0;
    const result = applyPanelConfig(
      {
        applyConfig: () => {},
      },
      {
        outcome: "saved",
        rawYaml: "density: [",
      },
      (message) => notifications.push(message),
      {
        path: "/tmp/minifooter.yml",
        save: () => {
          saveCalls += 1;
        },
      },
    );
    expect(result).toBe(false);
    expect(saveCalls).toBe(0);
    expect(notifications[0]).toContain("line 1");
  });

  test("unknown parameter id is visible and does not save", () => {
    const notifications: string[] = [];
    let saveCalls = 0;
    const result = applyPanelConfig(
      {
        applyConfig: () => {},
      },
      {
        outcome: "saved",
        rawYaml: "footer_layout:\n  - separator: slash\n    items: [not_a_parameter]",
      },
      (message) => notifications.push(message),
      {
        path: "/tmp/minifooter.yml",
        save: () => {
          saveCalls += 1;
        },
      },
    );
    expect(result).toBe(false);
    expect(saveCalls).toBe(0);
    expect(notifications[0]).toContain("invalid");
  });

  test("unordered thresholds are visible and do not save", () => {
    const notifications: string[] = [];
    let saveCalls = 0;
    const result = applyPanelConfig(
      {
        applyConfig: () => {},
      },
      {
        outcome: "saved",
        rawYaml:
          "thresholds: { context_warn: 80, context_alert: 50, context_danger: 90 }",
      },
      (message) => notifications.push(message),
      {
        path: "/tmp/minifooter.yml",
        save: () => {
          saveCalls += 1;
        },
      },
    );
    expect(result).toBe(false);
    expect(saveCalls).toBe(0);
    expect(notifications[0]).toContain("threshold");
  });
});

describe("openGlimpsePanel", () => {
  function fakeGlimpse(
    answer: unknown,
    calls: {
      html?: string;
    }[] = [],
  ): GlimpseModule {
    return {
      prompt: async (html: string) => {
        calls.push({
          html,
        });
        return answer;
      },
    };
  }

  test("import failure → unavailable (fail-closed)", async () => {
    const result = await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () => null,
    });
    expect(result).toEqual({
      outcome: "unavailable",
    });
  });

  test("loader throwing → unavailable", async () => {
    const result = await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () => {
        throw new Error("no webview");
      },
    });
    expect(result).toEqual({
      outcome: "unavailable",
    });
  });

  test("null answer (window closed / Esc) → cancelled", async () => {
    const result = await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () => fakeGlimpse(null),
    });
    expect(result).toEqual({
      outcome: "cancelled",
    });
  });

  test("non-save action → cancelled", async () => {
    const result = await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () =>
        fakeGlimpse({
          action: "other",
          config: {},
        }),
    });
    expect(result).toEqual({
      outcome: "cancelled",
    });
  });

  test("save action returns the config object", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.density = "compact";
    const result = await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () =>
        fakeGlimpse({
          action: "save",
          config: cfg,
        }),
    });
    expect(result).toEqual({
      config: cfg,
      outcome: "saved",
    });
  });

  test("save action returns raw YAML", async () => {
    const result = await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () =>
        fakeGlimpse({
          action: "save",
          rawYaml: "density: compact",
        }),
    });
    expect(result).toEqual({
      outcome: "saved",
      rawYaml: "density: compact",
    });
  });
  test("renders Form and YAML Source tabs with full source helpers", () => {
    const html = buildPanelHtml(enConfig());
    expect(html).toContain('data-tab="formTab"');
    expect(html).toContain('data-tab="sourceTab"');
    expect(html).toContain('id="yaml_source"');
    expect(html).toContain("Insert template");
    expect(html).toContain("12-parameter reference");
    for (const id of [
      "model_name",
      "model_id",
      "provider",
      "thinking_mode",
      "git_branch",
      "cwd_path",
      "context_bar",
      "context_compact",
      "tokens",
      "cost",
      "session_time",
      "native_footer",
    ]) {
      expect(html).toContain(`<code>${id}</code>`);
    }
    expect(html).toContain("editor_padding: default | relaxed");
    expect(html).toContain(
      'window.glimpse.send({ action: action, rawYaml: val("yaml_source") })',
    );
    expect(html).not.toContain('<button id="apply"');
    // bug02 回归: Cancel/Esc 走正式关闭协议, 不再发送非法 null 消息
    expect(html).not.toContain("send(null)");
    expect(html.match(/window\.glimpse\.close\(\)/g)).toHaveLength(1);
    expect(html).toContain(
      'if (window.glimpse && typeof window.glimpse.close === "function") window.glimpse.close();',
    );
    expect(html).toContain(
      'if (!window.glimpse || typeof window.glimpse.send !== "function") return;',
    );
  });

  test("panel HTML passed to glimpse.prompt contains the form", async () => {
    const calls: {
      html?: string;
    }[] = [];
    await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () => fakeGlimpse(null, calls),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.html).toContain('id="save"');
    expect(calls[0]?.html).toContain('id="layoutRows"');
    expect(calls[0]?.html).not.toContain('<button id="apply"');
  });

  function fakeOpenGlimpse(
    emit: (win: {
      close: () => void;
      emit: (event: string, data?: unknown) => void;
      send?: (js: string) => void;
    }) => void,
    calls: {
      html?: string;
    }[] = [],
    sent: string[] = [],
  ): GlimpseModule {
    return {
      open(html: string) {
        calls.push({
          html,
        });
        const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
        const win: GlimpseWindow & {
          emit: (event: string, data?: unknown) => void;
        } = {
          close() {
            win.emit("closed");
          },
          emit(event, data) {
            for (const listener of listeners.get(event) ?? []) listener(data);
          },
          on(event, listener) {
            const current = listeners.get(event) ?? [];
            current.push(listener);
            listeners.set(event, current);
            return win;
          },
          once(event, listener) {
            const wrap = (...args: unknown[]) => {
              const current = listeners.get(event) ?? [];
              listeners.set(
                event,
                current.filter((item) => item !== wrap),
              );
              listener(...args);
            };
            return win.on(event, wrap);
          },
          send(js: string) {
            sent.push(js);
          },
        };
        queueMicrotask(() => emit(win));
        return win;
      },
      prompt: async () => {
        throw new Error("prompt fallback should not run when open exists");
      },
    };
  }

  test("open() Apply keeps the window open and Save closes it", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.density = "compact";
    const applied: unknown[] = [];
    const calls: {
      html?: string;
    }[] = [];
    let closed = 0;
    const result = await openGlimpsePanel(enConfig(), {
      load: async () =>
        fakeOpenGlimpse((win) => {
          const originalClose = win.close.bind(win);
          win.close = () => {
            closed += 1;
            originalClose();
          };
          win.emit("message", {
            action: "other",
            config: cfg,
          });
          win.emit("message", {
            action: "apply",
          });
          win.emit("message", {
            action: "apply",
            config: cfg,
          });
          win.emit("message", {
            action: "apply",
            rawYaml: "density: compact",
          });
          win.emit("message", {
            action: "save",
            config: cfg,
          });
        }, calls),
      onApply: (payload) => applied.push(payload),
    });
    expect(calls[0]?.html).toContain(
      '<button id="apply" type="button" data-i18n="apply">Apply</button>',
    );
    expect(applied).toEqual([
      {
        config: cfg,
        outcome: "saved",
      },
      {
        outcome: "saved",
        rawYaml: "density: compact",
      },
    ]);
    expect(closed).toBe(1);
    expect(result).toEqual({
      config: cfg,
      outcome: "saved",
    });
  });

  test("open() close without save is cancelled", async () => {
    const applied: unknown[] = [];
    const result = await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () =>
        fakeOpenGlimpse((win) => {
          win.emit("message", {
            action: "apply",
            config: structuredClone(DEFAULT_CONFIG),
          });
          win.close();
        }),
      onApply: (payload) => applied.push(payload),
    });
    expect(applied).toHaveLength(1);
    expect(result).toEqual({
      outcome: "cancelled",
    });
  });

  test("open() Apply executes window.postMessage via win.send string", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    const sent: string[] = [];
    await openGlimpsePanel(enConfig(), {
      load: async () =>
        fakeOpenGlimpse(
          (win) => {
            win.emit("message", {
              action: "apply",
              config: cfg,
            });
            win.close();
          },
          [],
          sent,
        ),
      onApply: (_payload, respond) => {
        respond?.({
          message: "config applied",
          ok: true,
        });
      },
    });
    expect(sent).toHaveLength(1);
    expect(typeof sent[0]).toBe("string");
    expect(sent[0]?.startsWith("window.postMessage(")).toBe(true);
    expect(sent[0]?.endsWith(', "*");')).toBe(true);
    const json = JSON.parse(
      sent[0]?.slice("window.postMessage(".length, -', "*");'.length) ?? "{}",
    );
    expect(json).toEqual({
      message: "config applied",
      ok: true,
      type: "apply-result",
    });
  });

  test("language switching script refreshes dynamic texts and status", () => {
    const html = buildPanelHtml(enConfig(), {
      liveApply: true,
      nativeStatuses: [
        {
          key: "test",
          text: "● test:ok",
        },
      ],
    });
    expect(html).toContain("function refreshLanguage()");
    expect(html).toContain('el("lang").addEventListener("change", refreshLanguage)');
    expect(html).toContain("TXT.nativeStatusMax = text.nativeStatusMax;");
    expect(html).toContain("renderRows();");
    expect(html).toContain("renderPreview();");
    expect(html).toContain("renderNativeStatusList();");
  });

  test("Cancel closes panel without submitting saved payload", async () => {
    const applied: unknown[] = [];
    let closeCalled = 0;
    const result = await openGlimpsePanel(enConfig(), {
      load: async () =>
        fakeOpenGlimpse((win) => {
          const origClose = win.close.bind(win);
          win.close = () => {
            closeCalled += 1;
            origClose();
          };
          win.close();
        }),
      onApply: (payload) => applied.push(payload),
    });
    expect(closeCalled).toBe(1);
    expect(applied).toHaveLength(0);
    expect(result).toEqual({
      outcome: "cancelled",
    });
  });
});

// ─── native_status panel wiring (task 4.1-4.5) ──────────────────────────────

describe("native_status panel wiring (task 4.1-4.5)", () => {
  function htmlWithNativeStatuses(
    statuses: {
      key: string;
      text: string;
    }[],
    overrides: Partial<MinifooterConfig> = {},
  ): string {
    return buildPanelHtml(
      {
        ...structuredClone(DEFAULT_CONFIG),
        ...overrides,
      },
      {
        nativeStatuses: statuses,
      },
    );
  }

  test("injects native status entries with keys", () => {
    const html = htmlWithNativeStatuses([
      {
        key: "caveman",
        text: "○ caveman idle",
      },
      {
        key: "rtk",
        text: "● rtk:on",
      },
    ]);
    expect(html).toContain(
      'var NATIVE_STATUSES = [{"key":"caveman","text":"○ caveman idle"},{"key":"rtk","text":"● rtk:on"}]',
    );
  });

  test("injects hidden keys from config", () => {
    const html = htmlWithNativeStatuses(
      [
        {
          key: "rtk",
          text: "● rtk:on",
        },
      ],
      {
        native_status: {
          hidden: [
            "rtk",
          ],
        },
      },
    );
    expect(html).toContain('var NATIVE_HIDDEN = ["rtk"]');
  });

  test("checkbox toggles write back into native_status.hidden", () => {
    const html = htmlWithNativeStatuses([
      {
        key: "rtk",
        text: "● rtk:on",
      },
    ]);
    expect(html).toContain("data-native-key=");
    expect(html).toContain("native_status: { hidden: (NATIVE_HIDDEN || []).slice() }");
    assertPanelScriptIsValid(html);
  });

  test("keys present in hidden but not observed are listed as not running", () => {
    const html = htmlWithNativeStatuses([], {
      native_status: {
        hidden: [
          "rtk",
        ],
      },
    });
    expect(html).toContain('var NATIVE_HIDDEN = ["rtk"]');
    expect(html).toContain("nativeStatusOffline");
    expect(html).toContain("rows.push({ key: key, label: text.nativeStatusOffline })");
  });

  test("native footer items expose a bounded capacity input", () => {
    const html = htmlWithNativeStatuses([]);
    expect(html).toContain("data-native-max=");
    expect(html).toContain('min="1" max="5"');
    expect(html).toContain("if (obj.id !== 'native_footer') delete obj.max;");
  });

  test("preview reports statuses the capacity cannot display", () => {
    const html = htmlWithNativeStatuses([
      {
        key: "a",
        text: "a",
      },
      {
        key: "b",
        text: "b",
      },
      {
        key: "c",
        text: "c",
      },
      {
        key: "d",
        text: "d",
      },
      {
        key: "e",
        text: "e",
      },
    ]);
    expect(html).toContain("renderNativeStatusNotices");
    expect(html).toContain("nativeStatusOverflow");
    expect(html).toContain("pool.slice(cap).join(', ')");
    assertPanelScriptIsValid(html);
  });

  test("border slots holding native_footer report the no-capacity hint", () => {
    const html = htmlWithNativeStatuses([]);
    expect(html).toContain("nativeStatusBorderHint");
    expect(html).toContain("nativeBorderOwns");
    assertPanelScriptIsValid(html);
  });

  test("capacity round-trips through the layout reader", () => {
    const html = htmlWithNativeStatuses([]);
    expect(html).toContain("native_footer_layout: readLayout(nativeLayoutRows)");
    expect(html).toContain("function toItemObject(item)");
    expect(html).toContain("if (item.max !== undefined) out.max = item.max;");
  });
});

// ─── panel script behaviour (task 4.1-4.4) ──────────────────────────────────

interface PanelNode {
  addEventListener(type: string, handler: () => void): void;
  checked: boolean;
  classList: {
    add(): void;
    remove(): void;
    toggle(): void;
  };
  disabled: boolean;
  focus(): void;
  getAttribute(name: string): string | null;
  id: string;
  innerHTML: string;
  querySelector(selector: string): PanelNode | null;
  querySelectorAll(selector: string): PanelNode[];
  setAttribute(name: string, value: string): void;
  style: Record<string, string>;
  textContent: string;
  value: string;
}

/**
 * 在最小 DOM stub 上跑面板内联脚本, 以便对真实浏览器逻辑(勾选/容量/collect)
 * 做行为断言, 而不是只断言生成的标记。
 */
function runPanelScript(
  html: string,
  options: {
    borderSlots?: Record<string, string>;
    hiddenKeys?: string[];
    lang: string;
    nativeStatusKeys: string[];
  },
) {
  const handlers = new Map<string, () => void>();
  const nodes = new Map<string, PanelNode>();
  const sent: {
    action: string;
    config: Record<string, unknown>;
  }[] = [];

  function makeNode(id: string): PanelNode {
    const node: PanelNode = {
      checked: false,
      disabled: false,
      addEventListener(type, handler) {
        handlers.set(`${id}:${type}`, handler);
      },
      classList: {
        add() {},
        remove() {},
        toggle() {},
      },
      focus() {},
      getAttribute: () => null,
      id,
      innerHTML: "",
      style: {},
      textContent: "",
      value: "",
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute: () => {},
    };
    nodes.set(id, node);
    return node;
  }

  const hiddenKeys = options.hiddenKeys ?? [];
  const nativeKeyNodes = options.nativeStatusKeys.map((key) => {
    const node = makeNode(`native-key:${key}`);
    node.getAttribute = () => key;
    // 模拟真实标记: 未隐藏的 key 渲染为已勾选
    node.checked = !hiddenKeys.includes(key);
    return node;
  });
  const listNode = makeNode("nativeStatusList");
  listNode.querySelectorAll = (selector: string) =>
    selector === "[data-native-key]" ? nativeKeyNodes : [];

  const langNode = makeNode("lang");
  langNode.value = options.lang;

  // 模拟边框槽 select 的当前值
  for (const [slot, value] of Object.entries(options.borderSlots ?? {})) {
    makeNode(`${slot}_1`).value = value;
  }
  const documentStub = {
    addEventListener() {},
    documentElement: {
      style: {
        setProperty() {},
      },
    },
    getElementById: (id: string) => {
      if (id === "nativeStatusList") return listNode;
      return nodes.get(id) ?? makeNode(id);
    },
    querySelectorAll: () => [],
  };

  const script = html.match(PANEL_SCRIPT_PATTERN)?.[1];
  if (script === undefined) throw new Error("panel script not found");
  new Script(script).runInNewContext({
    document: documentStub,
    window: {
      addEventListener() {},
      glimpse: {
        close() {},
        send(payload: { action: string; config: Record<string, unknown> }) {
          sent.push(payload);
        },
      },
    },
  });

  return {
    handlers,
    nativeKeyNodes,
    nodes,
    sent,
  };
}

describe("panel script behaviour (task 4.1-4.4)", () => {
  const baseConfig = () => structuredClone(DEFAULT_CONFIG);

  test("clearing a status row writes its key into native_status.hidden", () => {
    const html = buildPanelHtml(baseConfig(), {
      nativeStatuses: [
        {
          key: "rtk",
          text: "● rtk:on",
        },
        {
          key: "caveman",
          text: "○ caveman idle",
        },
      ],
    });
    const { handlers, nativeKeyNodes, sent } = runPanelScript(html, {
      lang: "en",
      nativeStatusKeys: [
        "rtk",
        "caveman",
      ],
    });

    const rtk = nativeKeyNodes[0];
    expect(rtk?.checked).toBe(true);
    if (rtk === undefined) throw new Error("rtk node missing");
    rtk.checked = false;
    handlers.get("native-key:rtk:change")?.();

    handlers.get("save:click")?.();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.config.native_status).toEqual({
      hidden: [
        "rtk",
      ],
    });
  });

  test("hidden keys survive a save when the extension is not running", () => {
    const config = baseConfig();
    config.native_status = {
      hidden: [
        "rtk",
      ],
    };
    const html = buildPanelHtml(config, {
      nativeStatuses: [],
    });
    const { handlers, sent } = runPanelScript(html, {
      lang: "en",
      nativeStatusKeys: [],
    });
    handlers.get("save:click")?.();
    expect(sent[0]?.config.native_status).toEqual({
      hidden: [
        "rtk",
      ],
    });
  });

  test("re-selecting a hidden status removes it from native_status.hidden", () => {
    const config = baseConfig();
    config.native_status = {
      hidden: [
        "rtk",
      ],
    };
    const html = buildPanelHtml(config, {
      nativeStatuses: [
        {
          key: "rtk",
          text: "● rtk:on",
        },
      ],
    });
    const { handlers, nativeKeyNodes, sent } = runPanelScript(html, {
      lang: "en",
      hiddenKeys: [
        "rtk",
      ],
      nativeStatusKeys: [
        "rtk",
      ],
    });

    const rtk = nativeKeyNodes[0];
    if (rtk === undefined) throw new Error("rtk node missing");
    expect(rtk.checked).toBe(false);
    rtk.checked = true;
    handlers.get("native-key:rtk:change")?.();

    handlers.get("save:click")?.();
    expect(sent[0]?.config.native_status).toEqual({
      hidden: [],
    });
  });

  test("overflow notice lists the statuses capacity cannot display", () => {
    const config = baseConfig();
    config.footer_layout = [];
    config.native_footer_layout = [
      {
        separator: "space",
        items: [
          {
            id: "native_footer",
            max: 3,
          },
        ],
      },
    ];
    const html = buildPanelHtml(config, {
      nativeStatuses: [
        "a",
        "b",
        "c",
        "d",
        "e",
      ].map((key) => ({
        key,
        text: key,
      })),
    });
    const { nodes } = runPanelScript(html, {
      lang: "en",
      nativeStatusKeys: [
        "a",
        "b",
        "c",
        "d",
        "e",
      ],
    });
    expect(nodes.get("nativeOverflow")?.textContent).toContain("d, e");
  });

  test("border hint appears when a slot holds native_footer", () => {
    const config = baseConfig();
    config.border_slots = {
      ...structuredClone(DEFAULT_CONFIG.border_slots),
      top_right: [
        "native_footer",
      ],
    };
    const html = buildPanelHtml(config, {
      nativeStatuses: [
        {
          key: "rtk",
          text: "● rtk:on",
        },
      ],
    });
    const { nodes } = runPanelScript(html, {
      lang: "en",
      borderSlots: {
        top_right: "native_footer",
      },
      nativeStatusKeys: [
        "rtk",
      ],
    });
    expect(nodes.get("nativeBorderHint")?.textContent).toContain("border slot");
    expect(nodes.get("nativeOverflow")?.textContent).toBe("");
  });
});
