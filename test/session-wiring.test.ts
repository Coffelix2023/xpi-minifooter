import { describe, expect, test } from "vitest";
import type { MinifooterConfig } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { type BorderSlots, shouldInstallEditor } from "../src/editor-border.js";
import type { SessionUsage } from "../src/segments.js";
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
            input: 100,
            output: 50,
            cost: {
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
            input: 10,
            output: 5,
            cost: {
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
      mcpCount: 0,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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
      mcpCount: 0,
      model: undefined,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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
      mcpCount: 0,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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
      mcpCount: 0,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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
      mcpCount: 0,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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
      mcpCount: 0,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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
      mcpCount: 0,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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

  test("item showIcon=false overrides global icons", () => {
    const inputs: SegmentInputs = {
      branchName: "main",
      contextPct: null,
      cwd: "/tmp/project",
      elapsedSeconds: null,
      home: "/tmp",
      mcpCount: 0,
      model: undefined,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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
      mcpCount: 0,
      model: undefined,
      modelNames: {},
      nativeStatuses: [
        "● rtk:on",
      ],
      skillCount: 0,
      thinkingLevel: null,
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
      mcpCount: 0,
      model: undefined,
      modelNames: {},
      nativeStatuses: [],
      skillCount: 0,
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
