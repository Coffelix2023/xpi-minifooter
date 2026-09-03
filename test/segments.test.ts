import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test } from "vitest";
import {
  loadModelNames,
  modelsJsonPath,
  resolveCwdPath,
  resolveModelId,
  resolveModelName,
  resolveProvider,
  resolveThinkingMode,
  type SegmentContext,
  validateParameterIds,
} from "../src/segments.js";

const HOME = homedir();
const CWD = join(HOME, "c6x_local", "app-prd", "xpi-minifooter");

function seg(overrides: Partial<SegmentContext> = {}): SegmentContext {
  return {
    cwd: CWD,
    home: HOME,
    thinkingLevel: "medium",
    width: 120,
    model: {
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      provider: "zeta",
    },
    ...overrides,
  };
}

// models.json 读取桩: fakeFiles.get(p).length 充当 mtimeMs
let fakeFiles = new Map<string, string>();
const fakeStat = (p: string) => {
  const v = fakeFiles.get(p);
  if (v === undefined) throw new Error("missing");
  return {
    mtimeMs: v.length,
  };
};
const fakeRead = (p: string) => {
  const v = fakeFiles.get(p);
  if (v === undefined) throw new Error("missing");
  return v;
};

afterEach(() => {
  fakeFiles = new Map();
});

describe("2.1 closed registry", () => {
  test("unknown id rejected", () => {
    expect(
      validateParameterIds([
        "git_branch",
        "cost",
      ]),
    ).toEqual([
      "git_branch",
      "cost",
    ]);
    expect(
      validateParameterIds([
        "weather",
      ]),
    ).toBeNull();
    expect(
      validateParameterIds([
        "git_branch",
        "nope",
      ]),
    ).toBeNull();
  });
});

describe("2.2 model_name", () => {
  test("friendly name from models.json wins", () => {
    fakeFiles.set(
      "/fake/models.json",
      JSON.stringify({
        providers: {
          zeta: {
            apiKey: "sk-secret",
            models: [
              {
                id: "gpt-5.6-luna",
                name: "[⚡️ ZETA 直连] gpt-5.6-luna",
              },
            ],
          },
        },
      }),
    );
    const idx = loadModelNames("/fake/models.json", fakeStat, fakeRead);
    expect(resolveModelName(seg(), idx)).toBe("[⚡️ ZETA 直连] gpt-5.6-luna");
  });

  test("missing name falls back to ctx.model.name then id", () => {
    fakeFiles.set(
      "/fake/models.json",
      JSON.stringify({
        providers: {
          zeta: {
            models: [
              {
                id: "other",
              },
            ],
          },
        },
      }),
    );
    const idx = loadModelNames("/fake/models.json", fakeStat, fakeRead);
    // models.json 无匹配 id → 回退 ctx.model.name(非空)
    expect(resolveModelName(seg(), idx)).toBe("GPT-5.6 Luna");
    // ctx.model.name 为空 → 回退 id
    const noName = seg({
      model: {
        id: "gpt-5.6-luna",
        name: "",
        provider: "zeta",
      },
    });
    expect(resolveModelName(noName, idx)).toBe("gpt-5.6-luna");
  });

  test("missing models.json → empty index, still falls back", () => {
    const idx = loadModelNames("/fake/none.json", fakeStat, fakeRead);
    expect(idx).toEqual({});
    expect(resolveModelName(seg(), idx)).toBe("GPT-5.6 Luna");
  });

  test("corrupt models.json treated as no names", () => {
    fakeFiles.set("/fake/models.json", "{oops");
    expect(loadModelNames("/fake/models.json", fakeStat, fakeRead)).toEqual({});
  });

  test("no active model → omitted", () => {
    expect(
      resolveModelName(
        seg({
          model: undefined,
        }),
        {},
      ),
    ).toBeNull();
  });

  test("models.json path is under agent dir", () => {
    expect(modelsJsonPath()).toContain("models.json");
  });

  test("secret fields are never indexed", () => {
    fakeFiles.set(
      "/fake/models.json",
      JSON.stringify({
        providers: {
          zeta: {
            apiKey: "sk-should-not-appear",
            models: [
              {
                id: "gpt-5.6-luna",
                name: "Luna",
              },
            ],
          },
        },
      }),
    );
    const idx = JSON.stringify(loadModelNames("/fake/models.json", fakeStat, fakeRead));
    expect(idx).not.toContain("sk-should-not-appear");
    expect(idx).not.toContain("apiKey");
  });

  test("mtime cache: same mtime returns cached index", () => {
    fakeFiles.set(
      "/fake/models.json",
      JSON.stringify({
        providers: {
          zeta: {
            models: [
              {
                id: "a",
                name: "A",
              },
            ],
          },
        },
      }),
    );
    const first = loadModelNames("/fake/models.json", fakeStat, fakeRead);
    // 内容变但 mtimeMs(length)不变 → 仍用缓存
    fakeFiles.set(
      "/fake/models.json",
      JSON.stringify({
        providers: {
          zeta: {
            models: [
              {
                id: "b",
                name: "B",
              },
            ],
          },
        },
      }),
    );
    const second = loadModelNames("/fake/models.json", fakeStat, fakeRead);
    expect(second).toStrictEqual(first);
  });
});

describe("2.2b model_id", () => {
  test("shows raw model id; no model → null", () => {
    expect(resolveModelId(seg())).toBe("gpt-5.6-luna");
    expect(
      resolveModelId(
        seg({
          model: undefined,
        }),
      ),
    ).toBeNull();
  });
});

describe("2.3 provider & thinking_mode", () => {
  test("provider shows ctx.model.provider", () => {
    expect(resolveProvider(seg())).toBe("zeta");
    expect(
      resolveProvider(
        seg({
          model: undefined,
        }),
      ),
    ).toBeNull();
  });

  test("thinking_mode shows level text", () => {
    expect(resolveThinkingMode(seg())).toBe("medium");
    expect(
      resolveThinkingMode(
        seg({
          thinkingLevel: "xhigh",
        }),
      ),
    ).toBe("xhigh");
    expect(
      resolveThinkingMode(
        seg({
          thinkingLevel: undefined,
        }),
      ),
    ).toBeNull();
  });
});

describe("2.4 cwd_path grades", () => {
  test("basename", () => {
    expect(resolveCwdPath(seg(), "basename")).toBe("xpi-minifooter");
  });

  test("relative replaces home with ~", () => {
    expect(resolveCwdPath(seg(), "relative")).toBe(
      `~${sep}c6x_local${sep}app-prd${sep}xpi-minifooter`,
    );
  });

  test("relative outside home keeps absolute path", () => {
    expect(
      resolveCwdPath(
        seg({
          cwd: "/opt/somewhere",
        }),
        "relative",
      ),
    ).toBe("/opt/somewhere");
  });

  test("full keeps absolute path", () => {
    expect(resolveCwdPath(seg(), "full")).toBe(CWD);
  });
  test("long path truncated to width", () => {
    const narrow = seg({
      width: 8,
    });
    expect(visibleWidth(resolveCwdPath(narrow, "basename"))).toBeLessThanOrEqual(8);
  });
});

describe("real fs smoke", () => {
  test("real models.json parses when present", () => {
    const p = modelsJsonPath();
    try {
      statSync(p);
    } catch {
      return; // 无文件则跳过
    }
    const idx = loadModelNames(p, statSync, (pp) => readFileSync(pp, "utf8"));
    expect(Object.keys(idx).length).toBeGreaterThan(0);
  });
});
