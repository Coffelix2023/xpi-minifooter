import { beforeEach, describe, expect, test } from "vitest";
import {
  contextLevel,
  countMcpServers,
  countSkills,
  packageShortName,
  parseGitStatusPorcelain,
  resetGitCache,
  resolveContextBar,
  resolveContextCompact,
  resolveCost,
  resolveCwdPath,
  resolveGitBranch,
  resolveMcpSkills,
  resolvePackages,
  resolveSessionTime,
  resolveTokens,
  type SegmentContext,
  type SessionUsage,
} from "../src/segments.js";

beforeEach(() => {
  resetGitCache();
});

const THRESHOLDS = {
  context_alert: 75,
  context_danger: 80,
  context_warn: 50,
};
const noopCtx = {
  cwd: "/x",
  home: "/",
  width: 120,
} as SegmentContext;

function usage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    costTotal: null,
    hasTurn: true,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

// ─── 2.5 git_branch ──────────────────────────────────────────────────────────

describe("2.5 git_branch", () => {
  test("porcelain parse: branch, counts, ahead/behind", () => {
    const out = [
      "## main...origin/main [ahead 1, behind 2]",
      " M file1.ts",
      "?? new.txt",
      "A  staged.txt",
      "!! ignored.txt",
      "",
    ].join("\n");
    const data = parseGitStatusPorcelain(out);
    expect(data).not.toBeNull();
    expect(data?.branch).toBe("main");
    expect(data?.staged).toBe(1);
    expect(data?.modified).toBe(1);
    expect(data?.untracked).toBe(1);
    expect(data?.dirty).toBe(3);
    expect(data?.ahead).toBe(1);
    expect(data?.behind).toBe(2);
  });

  test("porcelain without branch line → null", () => {
    expect(parseGitStatusPorcelain(" M a.txt\n")).toBeNull();
    expect(parseGitStatusPorcelain("")).toBeNull();
  });

  test("mini: branch only, skips porcelain entirely", () => {
    let ran = false;
    const run = () => {
      ran = true;
      return null;
    };
    expect(resolveGitBranch(noopCtx, "mini", "main", run)).toBe("main");
    expect(ran).toBe(false);
  });

  test("default dirty: `main [±N]`", () => {
    const run = () => "## main\n M a.txt\n M b.txt\n";
    expect(resolveGitBranch(noopCtx, "default", "main", run)).toBe("main [±2]");
  });

  test("default clean: bare branch name", () => {
    expect(resolveGitBranch(noopCtx, "default", "main", () => "## main\n")).toBe(
      "main",
    );
  });

  test("full: ahead/behind and counts", () => {
    const run = () =>
      "## main...origin/main [ahead 1, behind 0]\nA  s.txt\n M m.txt\n?? u.txt\n";
    expect(resolveGitBranch(noopCtx, "full", "main", run)).toBe(
      "main [↑1 ↓0 | +1 ~1 -1]",
    );
  });

  test("outside repo (branchName null) → omitted", () => {
    expect(resolveGitBranch(noopCtx, "default", null, () => "")).toBeNull();
  });

  test("git exec failure: default/full keep bare branch name", () => {
    expect(resolveGitBranch(noopCtx, "default", "main", () => null)).toBe("main");
  });

  test("porcelain cached for 2s window", () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return "## main\n M a\n";
    };
    resolveGitBranch(noopCtx, "default", "main", run, 1000);
    resolveGitBranch(noopCtx, "default", "main", run, 2500);
    resolveGitBranch(noopCtx, "default", "main", run, 3500);
    expect(calls).toBe(2);
  });
});

// ─── 2.6 context_bar / context_compact ──────────────────────────────────────

describe("2.6 context bar", () => {
  test("level tiers respect thresholds", () => {
    expect(contextLevel(10, THRESHOLDS)).toBe("ok");
    expect(contextLevel(50, THRESHOLDS)).toBe("warn");
    expect(contextLevel(75, THRESHOLDS)).toBe("alert");
    expect(contextLevel(80, THRESHOLDS)).toBe("danger");
    expect(contextLevel(null, THRESHOLDS)).toBeNull();
  });

  test("bar glyphs and percent", () => {
    expect(resolveContextBar(noopCtx, 0, THRESHOLDS, false)).toBe("░░░░░░░░░░ 0%");
    expect(resolveContextBar(noopCtx, 80, THRESHOLDS, false)).toBe("████████░░ 80%");
    expect(resolveContextBar(noopCtx, 100, THRESHOLDS, false)).toBe("██████████ 100%");
    expect(resolveContextBar(noopCtx, 50, THRESHOLDS, true)).toBe("#####----- 50%");
  });

  test("unknown window marker", () => {
    expect(resolveContextBar(noopCtx, null, THRESHOLDS, false)).toBe("~%");
    expect(resolveContextCompact(noopCtx, null)).toBe("~");
    expect(contextLevel(null, THRESHOLDS)).toBeNull();
  });
});

// ─── 2.7 tokens / cost / session_time ───────────────────────────────────────

describe("2.7 usage segments", () => {
  test("tokens formats in/out with k/M", () => {
    expect(
      resolveTokens(
        noopCtx,
        usage({
          inputTokens: 500,
          outputTokens: 20_000,
        }),
      ),
    ).toBe("↑500 ↓20.0k");
    expect(
      resolveTokens(
        noopCtx,
        usage({
          inputTokens: 1_234_567,
          outputTokens: 1,
        }),
      ),
    ).toBe("↑1.2M ↓1");
  });

  test("tokens omitted before first turn", () => {
    expect(
      resolveTokens(
        noopCtx,
        usage({
          hasTurn: false,
        }),
      ),
    ).toBeNull();
  });

  test("cost shows $ with 3 decimals", () => {
    expect(
      resolveCost(
        noopCtx,
        usage({
          costTotal: 0.12345,
        }),
      ),
    ).toBe("$0.123");
    expect(
      resolveCost(
        noopCtx,
        usage({
          costTotal: 0,
        }),
      ),
    ).toBe("$0.000");
  });

  test("cost omitted when unknown (spec scenario)", () => {
    expect(
      resolveCost(
        noopCtx,
        usage({
          costTotal: null,
        }),
      ),
    ).toBeNull();
  });

  test("session_time grade formats", () => {
    expect(resolveSessionTime(noopCtx, 42)).toBe("42s");
    expect(resolveSessionTime(noopCtx, 65)).toBe("1m 5s");
    expect(resolveSessionTime(noopCtx, 3661)).toBe("1h 1m");
    expect(resolveSessionTime(noopCtx, null)).toBeNull();
  });
});

// ─── 2.8 packages / mcp_skills ──────────────────────────────────────────────

describe("2.8 packages & mcp_skills", () => {
  test("short name strips scheme and path", () => {
    expect(packageShortName("npm:pi-lens")).toBe("pi-lens");
    expect(packageShortName("git:github.com/Coffelix2023/xpi-memo")).toBe("xpi-memo");
    expect(packageShortName("pi-lens")).toBe("pi-lens");
  });

  test("packages wrap-bounds with +N", () => {
    const entries = [
      "npm:pi-lens",
      "npm:context-mode",
      "git:github.com/a/b",
      "npm:d",
      "npm:e",
    ];
    expect(resolvePackages(noopCtx, entries, 3)).toBe("pi-lens, context-mode, b +2");
    expect(resolvePackages(noopCtx, entries, 5)).not.toContain("+");
  });

  test("packages omitted when empty", () => {
    expect(resolvePackages(noopCtx, [], 5)).toBeNull();
  });

  test("mcp server count from config json", () => {
    expect(countMcpServers('{"mcpServers":{"a":{},"b":{}}}')).toBe(2);
    expect(countMcpServers("{}")).toBe(0);
    expect(countMcpServers(null)).toBe(0);
    expect(countMcpServers("{bad")).toBe(0);
  });

  test("skills count from settings array/object plus dirs", () => {
    expect(countSkills('{"skills":["a","b"]}')).toBe(2);
    expect(countSkills('{"skills":{"a":1}}')).toBe(1);
    expect(
      countSkills(null, [
        "dir1",
        "dir2",
      ]),
    ).toBe(2);
    expect(countSkills('{"skills":[]}')).toBe(0);
  });

  test("mcp_skills omitted when both zero (spec scenario)", () => {
    expect(resolveMcpSkills(noopCtx, 0, 0)).toBeNull();
    expect(resolveMcpSkills(noopCtx, 3, 0)).toBe("MCP:3 · Skills:0");
    expect(resolveMcpSkills(noopCtx, 0, 12)).toBe("MCP:0 · Skills:12");
  });
});

describe("real cwd smoke", () => {
  test("resolveCwdPath basename of this repo", () => {
    expect(
      resolveCwdPath(
        {
          cwd: process.cwd(),
          home: "/",
          width: 120,
        },
        "basename",
      ),
    ).toBe("xpi-minifooter");
  });
});
