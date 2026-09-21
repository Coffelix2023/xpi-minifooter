import { describe, expect, test } from "vitest";
import type { MinifooterConfig } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { type BorderSlots, shouldInstallEditor } from "../src/editor-border.js";
import type { NativeStatusEntry, SessionUsage } from "../src/segments.js";
import {
  addEditorPadding,
  aggregateUsage,
  buildBorderSegments,
  buildFooterRows,
  type RuntimeDeps,
  renderSegment,
  type SegmentInputs,
  SessionRuntime,
  wireSession,
} from "../src/session.js";

// ─── mocks ──────────────────────────────────────────────────────────────────

function fakeConfig(overrides: Partial<MinifooterConfig> = {}): MinifooterConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...overrides,
  };
}

function fakePi() {
  const footerFactories: unknown[] = [];
  const editorCalls: unknown[] = [];
  const handlers = new Map<string, unknown>();
  const pi = {
    exec: async () => ({
      code: 0,
      killed: false,
      stderr: "",
      stdout: "",
    }),
    getThinkingLevel: () => "off" as const,
    on: (event: string, handler: unknown) => {
      handlers.set(event, handler);
    },
    registerCommand: () => {},
    registerTool: () => {},
  };
  const ui = {
    notify: () => {},
    setEditorComponent: (factory: unknown) => {
      editorCalls.push(factory);
    },
    setFooter: (factory: unknown) => {
      footerFactories.push(factory);
    },
    theme: {
      fg: (_t: string, s: string) => s,
    },
  };
  const ctx = {
    cwd: "/tmp",
    model: undefined,
    getContextUsage: () => undefined,
    sessionManager: {
      getBranch: () => [],
    },
    ui,
  };
  return {
    ctx,
    editorCalls,
    footerFactories,
    handlers,
    pi,
    ui,
  };
}

function wiredRuntime(config: MinifooterConfig, deps: Partial<RuntimeDeps> = {}) {
  const runtime = new SessionRuntime(deps);
  runtime.config = config;
  const mock = fakePi();
  wireSession(mock.pi as never, runtime);
  const startHandler = mock.handlers.get("session_start") as (
    event: unknown,
    ctx: unknown,
  ) => void;
  startHandler(
    {
      reason: "startup",
      type: "session_start",
    },
    mock.ctx,
  );
  return {
    mock,
    runtime,
  };
}

const baseDeps: RuntimeDeps = {
  configPath: () => "/nonexistent/minifooter.yml",
  statMtime: () => null,
};

// ─── 4.1 接线行为 ────────────────────────────────────────────────────────────

describe("wireSession (task 4.1)", () => {
  test("session_start installs footer", () => {
    const { mock } = wiredRuntime(fakeConfig(), baseDeps);
    expect(mock.footerFactories).toHaveLength(1);
  });

  test("empty border slots never call setEditorComponent", () => {
    const { mock, runtime } = wiredRuntime(fakeConfig(), baseDeps);
    expect(mock.editorCalls).toHaveLength(0);
    expect(runtime.editorInstalled).toBe(false);
  });

  test("non-empty border slots install editor once", () => {
    const config = fakeConfig({
      border_slots: {
        bottom_left: "cwd_path",
        bottom_right: "context_compact",
        top_left: "model_name",
        top_right: "thinking_mode",
      },
    });
    const { mock, runtime } = wiredRuntime(config, baseDeps);
    expect(mock.editorCalls).toHaveLength(1);
    expect(runtime.editorInstalled).toBe(true);
  });

  test("agent events are subscribed for re-render", () => {
    const { mock } = wiredRuntime(fakeConfig(), baseDeps);
    expect(mock.handlers.has("agent_start")).toBe(true);
    expect(mock.handlers.has("agent_settled")).toBe(true);
  });

  test("session_shutdown resets runtime state", () => {
    const { mock, runtime } = wiredRuntime(fakeConfig(), baseDeps);
    runtime.activeTui = {
      requestRender: () => {},
    } as never;
    runtime.startAt = 123;
    const shutdown = mock.handlers.get("session_shutdown") as () => void;
    shutdown();
    expect(runtime.activeTui).toBeNull();
    expect(runtime.startAt).toBe(0);
    expect(runtime.porcelain.raw).toBeNull();
  });
});

// ─── mtime 热重载 ────────────────────────────────────────────────────────────

describe("SessionRuntime.maybeReload", () => {
  function makeRuntime(opts: {
    load?: RuntimeDeps["loadConfig"];
    loadConfigWithError?: RuntimeDeps["loadConfigWithError"];
    mtimes: (number | null)[];
  }): {
    loadCalls: () => number;
    runtime: SessionRuntime;
  } {
    let statCalls = 0;
    let loadCalls = 0;
    const runtime = new SessionRuntime({
      loadConfigWithError: opts.loadConfigWithError,
      configPath: () => "/fake.yml",
      loadConfig: (p) => {
        loadCalls += 1;
        return opts.load ? opts.load(p) : null;
      },
      statMtime: () => {
        const m = opts.mtimes[Math.min(statCalls, opts.mtimes.length - 1)];
        statCalls += 1;
        return m;
      },
    });
    return {
      loadCalls: () => loadCalls,
      runtime,
    };
  }

  test("no file → keep defaults", () => {
    const { runtime } = makeRuntime({
      mtimes: [
        null,
      ],
    });
    expect(runtime.maybeReload()).toBe(false);
    expect(runtime.config).toEqual(DEFAULT_CONFIG);
  });

  test("same mtime → no reload", () => {
    const { loadCalls, runtime } = makeRuntime({
      load: () => ({
        config: fakeConfig({
          density: "compact",
        }),
        mtime: 10,
      }),
      mtimes: [
        10,
        10,
        10,
      ],
    });
    runtime.mtime = 10;
    expect(runtime.maybeReload()).toBe(false);
    expect(loadCalls()).toBe(0);
  });

  test("invalid file → keep last valid, notify once", () => {
    const notifications: string[] = [];
    const { loadCalls, runtime } = makeRuntime({
      load: () => null,
      mtimes: [
        5,
        5,
        5,
        5,
      ],
    });
    runtime.mtime = 4;
    expect(runtime.maybeReload((m) => notifications.push(m))).toBe(false);
    expect(notifications).toHaveLength(1);
    // 同一坏 mtime 再渲染 → 不重复 notify / 不重读
    expect(runtime.maybeReload((m) => notifications.push(m))).toBe(false);
    expect(loadCalls()).toBe(1);
    expect(notifications).toHaveLength(1);
  });

  test("invalid file → reports the parser error", () => {
    const notifications: string[] = [];
    const { runtime } = makeRuntime({
      loadConfigWithError: () => ({
        error: "invalid YAML at line 3",
        loaded: null,
      }),
      mtimes: [
        5,
      ],
    });
    runtime.mtime = 4;
    runtime.maybeReload((m) => notifications.push(m));
    expect(notifications[0]).toContain("invalid minifooter.yml");
    expect(notifications[0]).toContain("invalid YAML at line 3");
    expect(notifications[0]).toContain("keeping last valid config");
  });
  test("new valid mtime → config swapped", () => {
    const { runtime } = makeRuntime({
      load: () => ({
        config: fakeConfig({
          density: "spacious",
        }),
        mtime: 20,
      }),
      mtimes: [
        20,
      ],
    });
    runtime.mtime = 10;
    expect(runtime.maybeReload()).toBe(true);
    expect(runtime.config.density).toBe("spacious");
  });

  test("applyConfig swaps config and resyncs mtime", () => {
    let currentMtime: number | null = 30;
    const runtime = new SessionRuntime({
      configPath: () => "/fake.yml",
      statMtime: () => currentMtime,
    });
    runtime.applyConfig(
      fakeConfig({
        density: "compact",
      }),
    );
    expect(runtime.config.density).toBe("compact");
    // 面板已写入文件(mtime 30): 下一次渲染不再触发外部重载
    currentMtime = null;
    expect(runtime.maybeReload()).toBe(false);
  });
});

// ─── usage 聚合 ──────────────────────────────────────────────────────────────

describe("aggregateUsage", () => {
  test("sums assistant usage, ignores non-assistant entries", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "user",
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: {
            cacheRead: 1000,
            cacheWrite: 200,
            input: 100,
            output: 50,
            cost: {
              cacheRead: 0.0004,
              cacheWrite: 0.001,
              input: 0.004,
              output: 0.005,
              total: 0.01,
            },
          },
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: {
            cacheRead: 5,
            cacheWrite: 1,
            input: 10,
            output: 5,
            cost: {
              cacheRead: 0.0001,
              cacheWrite: 0.0002,
              input: 0.0004,
              output: 0.0005,
              total: 0.001,
            },
          },
        },
      },
      {
        type: "custom",
      },
    ] as never[];
    const u = aggregateUsage(entries);
    expect(u.inputTokens).toBe(110);
    expect(u.outputTokens).toBe(55);
    expect(u.costTotal).toBeCloseTo(0.011);
    expect(u.hasTurn).toBe(true);
    expect(u.cacheReadTokens).toBe(1005);
    expect(u.cacheWriteTokens).toBe(201);
    expect(u.costDetail?.input).toBeCloseTo(0.0044);
    expect(u.costDetail?.output).toBeCloseTo(0.0055);
    expect(u.costDetail?.cacheRead).toBeCloseTo(0.0005);
    expect(u.costDetail?.cacheWrite).toBeCloseTo(0.0012);
  });

  test("no turns → hasTurn false, cost null", () => {
    const u = aggregateUsage([] as never[]);
    expect(u.hasTurn).toBe(false);
    expect(u.costTotal).toBeNull();
  });
});

describe("addEditorPadding", () => {
  const lines = [
    "┌─ top ─┐",
    "content",
    "└─ bottom ─┘",
  ];
  test("default leaves lines untouched", () => {
    expect(
      addEditorPadding(
        [
          ...lines,
        ],
        "default",
      ),
    ).toEqual(lines);
  });
  test("relaxed inserts blank lines on both sides", () => {
    expect(
      addEditorPadding(
        [
          ...lines,
        ],
        "relaxed",
      ),
    ).toEqual([
      "┌─ top ─┐",
      "",
      "content",
      "",
      "└─ bottom ─┘",
    ]);
  });
});

// ─── slots 判定(供 shouldInstallEditor 对齐)────────────────────────────────

describe("border slot gating", () => {
  test("all-none slots skip install decision", () => {
    const slots: BorderSlots = {
      bottom_left: "none",
      bottom_right: "none",
      top_left: "none",
      top_right: "none",
    };
    expect(shouldInstallEditor(slots)).toBe(false);
  });
});

test("combines two parameters in one border slot", () => {
  const config = fakeConfig({
    border_slots: {
      ...structuredClone(DEFAULT_CONFIG.border_slots),
      top_left: [
        "model_id",
        "provider",
      ],
    },
  });
  const result = buildBorderSegments(
    config,
    {
      branchName: null,
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: null,
      home: "/tmp",
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: null,
      model: {
        id: "gpt-test",
        name: "GPT Test",
        provider: "openai",
      },
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    },
    120,
    () => null,
  );
  expect(result.top_left?.text).toContain("gpt-test");
  expect(result.top_left?.text).toContain("openai");
});

test("footer tokens/cost follow currency and usage_detail config", () => {
  const config = fakeConfig({
    cost_currency: "CNY",
    usage_detail: "both",
    usd_to_cny_rate: 7.2,
  });
  const rows = buildFooterRows(
    config,
    {
      branchName: null,
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: null,
      home: "/tmp",
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: null,
      usage: {
        cacheReadTokens: 60_000,
        cacheWriteTokens: 5_000,
        costTotal: 0.0037,
        hasTurn: true,
        inputTokens: 12_345,
        outputTokens: 3,
        costDetail: {
          cacheRead: 0.0005,
          cacheWrite: 0.0002,
          input: 0.001,
          output: 0.002,
        },
      },
    },
    200,
    () => null,
  );
  const text = rows
    .flatMap((row) => row.segments.map((segment) => segment.text))
    .join(" | ");
  expect(text).toContain("↑12k ↓3 R60k W5k");
  expect(text).toContain("¥0.027 ↑0.0072 ↓0.0144 R0.0036 W0.0014");
});

// ─── inputs/usage 形状兜底 ───────────────────────────────────────────────────

describe("SegmentInputs consumers", () => {
  test("unknown usage stays null cost (spec: cost omitted when unknown)", () => {
    const usage: SessionUsage = {
      costTotal: null,
      hasTurn: false,
      inputTokens: 0,
      outputTokens: 0,
    };
    const inputs: SegmentInputs = {
      branchName: null,
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: null,
      home: "/tmp",
      model: undefined,
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: null,
      usage,
    };
    expect(inputs.usage.costTotal).toBeNull();
  });

  test("fresh session omits only unknown usage segments", () => {
    const config = fakeConfig({
      show_icons: false,
    });
    const inputs: SegmentInputs = {
      branchName: "main",
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: 12,
      home: "/tmp",
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: "off",
      model: {
        id: "gpt-test",
        name: "gpt-test",
        provider: "test",
      },
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    const rows = buildFooterRows(config, inputs, 120, () => null);
    expect(rows[0]?.segments.map((segment) => segment.text)).toEqual([
      "main",
      "project",
      "gpt-test",
      "off",
    ]);
    expect(rows[1]?.segments.map((segment) => segment.text)).toEqual([
      "~%",
      "12s",
    ]);
  });

  test("border-selected parameters are omitted from footer rows", () => {
    const config = fakeConfig({
      border_slots: {
        bottom_left: "none",
        bottom_right: "none",
        top_left: "git_branch",
        top_right: "none",
      },
    });
    const inputs: SegmentInputs = {
      branchName: "main",
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: 12,
      home: "/tmp",
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: "off",
      model: {
        id: "gpt-test",
        name: "gpt-test",
        provider: "test",
      },
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    const rows = buildFooterRows(config, inputs, 120, () => null);
    expect(rows[0]?.segments.map((segment) => segment.id)).not.toContain("git_branch");
    expect(rows[0]?.segments.map((segment) => segment.id)).toContain("cwd_path");
  });

  test("all four border slots suppress matching footer parameters", () => {
    const config = fakeConfig({
      border_slots: {
        bottom_left: "cwd_path",
        bottom_right: "thinking_mode",
        top_left: "git_branch",
        top_right: "model_name",
      },
    });
    const inputs: SegmentInputs = {
      branchName: "main",
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: 12,
      home: "/tmp",
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: "off",
      model: {
        id: "gpt-test",
        name: "gpt-test",
        provider: "test",
      },
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    const occupied = buildFooterRows(config, inputs, 120, () => null);
    expect(occupied[0]?.segments.map((segment) => segment.id)).toEqual([]);
    const restored = buildFooterRows(
      fakeConfig({
        border_slots: {
          bottom_left: "none",
          bottom_right: "none",
          top_left: "none",
          top_right: "none",
        },
      }),
      inputs,
      120,
      () => null,
    );
    expect(restored[0]?.segments.map((segment) => segment.id)).toEqual([
      "git_branch",
      "cwd_path",
      "model_name",
      "thinking_mode",
    ]);
  });

  test("none border slots restore footer parameters", () => {
    const config = fakeConfig();
    const inputs: SegmentInputs = {
      branchName: "main",
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: 12,
      home: "/tmp",
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: "off",
      model: {
        id: "gpt-test",
        name: "gpt-test",
        provider: "test",
      },
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    const rows = buildFooterRows(config, inputs, 120, () => null);
    expect(rows[0]?.segments.map((segment) => segment.id)).toContain("git_branch");
  });

  test("tokens render after a real assistant turn", () => {
    const config = fakeConfig();
    const inputs: SegmentInputs = {
      branchName: "main",
      contextPct: 50,
      cwd: "/tmp/project",
      elapsedSeconds: 12,
      home: "/tmp",
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: "off",
      model: {
        id: "gpt-test",
        name: "gpt-test",
        provider: "test",
      },
      usage: {
        costTotal: null,
        hasTurn: true,
        inputTokens: 100,
        outputTokens: 25,
      },
    };
    expect(renderSegment("tokens", config, inputs, 120, () => null)?.text).toContain(
      "↑100 ↓25",
    );
  });

  test("border slot showIcon respects item and global settings", () => {
    const inputs: SegmentInputs = {
      branchName: "main",
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: null,
      home: "/tmp",
      model: undefined,
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: null,
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    const withIcon = buildBorderSegments(
      fakeConfig({
        border_slots: {
          ...structuredClone(DEFAULT_CONFIG.border_slots),
          top_left: {
            id: "git_branch",
            showIcon: true,
          },
        },
      }),
      inputs,
      120,
      () => null,
    );
    expect(withIcon.top_left?.text).not.toBe("main");
    const withoutIcon = buildBorderSegments(
      fakeConfig({
        show_icons: false,
        border_slots: {
          ...structuredClone(DEFAULT_CONFIG.border_slots),
          top_left: {
            id: "git_branch",
            showIcon: true,
          },
        },
      }),
      inputs,
      120,
      () => null,
    );
    expect(withoutIcon.top_left?.text).toBe("main");
  });

  test("item showIcon=false overrides global icons", () => {
    const inputs: SegmentInputs = {
      branchName: "main",
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: null,
      home: "/tmp",
      model: undefined,
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: null,
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    const row = buildFooterRows(
      fakeConfig({
        footer_layout: [
          {
            separator: "space",
            items: [
              {
                id: "git_branch",
                showIcon: false,
              },
            ],
          },
        ],
      }),
      inputs,
      120,
      () => null,
    );
    expect(row[0]?.segments[0]?.text).toBe("main");
  });

  test("renders native footer layout as separate rows", () => {
    const inputs: SegmentInputs = {
      branchName: null,
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: null,
      home: "/tmp",
      model: undefined,
      modelNames: {},
      thinkingLevel: null,
      nativeStatuses: [
        {
          key: "rtk",
          text: "● rtk:on",
        },
      ],
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    const rows = buildFooterRows(
      fakeConfig({
        footer_layout: [],
        native_footer_layout: [
          {
            separator: "space",
            items: [
              "native_footer",
            ],
          },
          {
            separator: "dot",
            items: [
              "native_footer",
            ],
          },
        ],
      }),
      inputs,
      120,
      () => null,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.separator)).toEqual([
      "space",
      "dot",
    ]);
    expect(rows[0]?.segments[0]?.text).toContain("rtk:on");
  });

  test("cwd_path uses populated context", () => {
    const config = fakeConfig({
      show_icons: false,
    });
    const inputs: SegmentInputs = {
      branchName: null,
      contextPct: null,
      cwd: "/Users/felix/c6x_local/app-prd/xpi-minifooter",
      elapsedSeconds: null,
      home: "/Users/felix",
      model: undefined,
      modelNames: {},
      nativeStatuses: [],
      thinkingLevel: null,
      usage: {
        costTotal: null,
        hasTurn: false,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    expect(renderSegment("cwd_path", config, inputs, 120, () => null)?.text).toBe(
      "xpi-minifooter",
    );
  });
});

// ─── native status packing (task 3.2, 3.3) ──────────────────────────────────

function nativeInputs(nativeStatuses: NativeStatusEntry[]): SegmentInputs {
  return {
    branchName: null,
    contextPct: null,
    cwd: "/tmp/project",
    elapsedSeconds: null,
    home: "/tmp",
    model: undefined,
    modelNames: {},
    nativeStatuses,
    thinkingLevel: null,
    usage: {
      costTotal: null,
      hasTurn: false,
      inputTokens: 0,
      outputTokens: 0,
    },
  };
}

function entries(...keys: string[]): NativeStatusEntry[] {
  return keys.map((key) => ({
    key,
    text: `${key}-text`,
  }));
}

describe("native status packing (task 3.2, 3.3)", () => {
  test("border native_footer suppresses every footer occurrence", () => {
    const rows = buildFooterRows(
      fakeConfig({
        border_slots: {
          ...structuredClone(DEFAULT_CONFIG.border_slots),
          top_right: [
            "native_footer",
          ],
        },
        footer_layout: [
          {
            separator: "space",
            items: [
              "native_footer",
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
      }),
      nativeInputs(entries("rtk")),
      120,
      () => null,
    );
    expect(rows.every((row) => row.segments.length === 0)).toBe(true);
  });

  test("capacity splits statuses across rows", () => {
    const rows = buildFooterRows(
      fakeConfig({
        footer_layout: [],
        native_footer_layout: [
          {
            separator: "space",
            items: [
              {
                id: "native_footer",
                max: 2,
              },
            ],
          },
          {
            separator: "dot",
            items: [
              {
                id: "native_footer",
                max: 3,
              },
            ],
          },
        ],
      }),
      nativeInputs(entries("a", "b", "c", "d", "e")),
      200,
      () => null,
    );
    expect(rows[0]?.segments.map((s) => s.text)).toEqual([
      "a-text",
      "b-text",
    ]);
    expect(rows[1]?.segments.map((s) => s.text)).toEqual([
      "c-text",
      "d-text",
      "e-text",
    ]);
  });

  test("omitted capacity fills a single row", () => {
    const rows = buildFooterRows(
      fakeConfig({
        footer_layout: [],
        native_footer_layout: [
          {
            separator: "space",
            items: [
              "native_footer",
            ],
          },
        ],
      }),
      nativeInputs(entries("a", "b", "c", "d")),
      200,
      () => null,
    );
    expect(rows[0]?.segments.map((s) => s.text)).toEqual([
      "a-text",
      "b-text",
      "c-text",
      "d-text",
    ]);
  });

  test("surplus statuses are dropped without a marker", () => {
    const rows = buildFooterRows(
      fakeConfig({
        footer_layout: [],
        native_footer_layout: [
          {
            separator: "space",
            items: [
              {
                id: "native_footer",
                max: 3,
              },
            ],
          },
        ],
      }),
      nativeInputs(entries("a", "b", "c", "d", "e")),
      200,
      () => null,
    );
    expect(rows[0]?.segments).toHaveLength(3);
    expect(rows[0]?.segments.map((s) => s.text)).toEqual([
      "a-text",
      "b-text",
      "c-text",
    ]);
  });

  test("hidden keys are removed before packing", () => {
    const rows = buildFooterRows(
      fakeConfig({
        footer_layout: [],
        native_footer_layout: [
          {
            separator: "space",
            items: [
              {
                id: "native_footer",
                max: 3,
              },
            ],
          },
        ],
        native_status: {
          hidden: [
            "b",
          ],
        },
      }),
      nativeInputs(entries("a", "b", "c", "d", "e")),
      200,
      () => null,
    );
    expect(rows[0]?.segments.map((s) => s.text)).toEqual([
      "a-text",
      "c-text",
      "d-text",
    ]);
  });

  test("each status is its own segment", () => {
    const rows = buildFooterRows(
      fakeConfig({
        footer_layout: [],
        native_footer_layout: [
          {
            separator: "dot",
            items: [
              "native_footer",
            ],
          },
        ],
      }),
      nativeInputs(entries("a", "b", "c")),
      200,
      () => null,
    );
    expect(rows[0]?.segments).toHaveLength(3);
    expect(rows[0]?.segments.every((s) => s.id === "native_footer")).toBe(true);
  });
});

// ─── border native_footer data path (task 3.4) ──────────────────────────────

describe("border native_footer (task 3.4)", () => {
  test("border slot renders every status without capacity", () => {
    const segs = buildBorderSegments(
      fakeConfig({
        border_slots: {
          ...structuredClone(DEFAULT_CONFIG.border_slots),
          top_right: [
            "native_footer",
          ],
        },
      }),
      nativeInputs(entries("a", "b", "c", "d", "e", "f")),
      200,
      () => null,
    );
    expect(segs.top_right?.text).toBe("a-text b-text c-text d-text e-text f-text");
  });

  test("border slot drops hidden statuses", () => {
    const segs = buildBorderSegments(
      fakeConfig({
        border_slots: {
          ...structuredClone(DEFAULT_CONFIG.border_slots),
          top_left: [
            "native_footer",
          ],
        },
        native_status: {
          hidden: [
            "b",
          ],
        },
      }),
      nativeInputs(entries("a", "b")),
      200,
      () => null,
    );
    expect(segs.top_left?.text).toBe("a-text");
  });

  test("no statuses leaves the border slot empty", () => {
    const segs = buildBorderSegments(
      fakeConfig({
        border_slots: {
          ...structuredClone(DEFAULT_CONFIG.border_slots),
          top_left: [
            "native_footer",
          ],
        },
      }),
      nativeInputs([]),
      200,
      () => null,
    );
    expect(segs.top_left).toBeNull();
  });

  test("footer factory stores footerData for the editor", () => {
    const { mock, runtime } = wiredRuntime(fakeConfig(), baseDeps);
    const footerData = {
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map([
          [
            "rtk",
            "● rtk:on",
          ],
        ]),
      getGitBranch: () => null,
      onBranchChange: () => () => {},
    };
    const factory = mock.footerFactories[0] as (
      tui: unknown,
      theme: unknown,
      data: unknown,
    ) => unknown;
    factory(
      {
        requestRender: () => {},
      },
      {
        fg: (_t: string, s: string) => s,
      },
      footerData,
    );
    expect(runtime.footerData).toBe(footerData);
  });
});
