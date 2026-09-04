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
    expect(html).toContain("输入与输出 token 数量");
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
        "● plugin:on",
      ],
    });
    expect(html).not.toContain('id="native_footer"');
    expect(html).toContain('id="nativeLayoutRows"');
    expect(html).toContain("native footer status: available: ● plugin:on");
    expect(html).toContain('var NATIVE_STATUSES = ["● plugin:on"]');
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
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
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
    expect(html).toContain("13-parameter reference");
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
      "mcp_skills",
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
        "● test:ok",
      ],
    });
    expect(html).toContain("function refreshLanguage()");
    expect(html).toContain('el("lang").addEventListener("change", refreshLanguage)');
    expect(html).toContain('var nfs = el("nativeFooterStatus");');
    expect(html).toContain("text.nativeFooterAvailable");
    expect(html).toContain("renderRows();");
    expect(html).toContain("renderPreview();");
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
