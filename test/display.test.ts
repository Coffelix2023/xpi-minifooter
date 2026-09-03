import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import {
  fitBorder,
  plainBorder,
  renderBorderLine,
  shouldInstallEditor,
} from "../src/editor-border.js";
import {
  contextColorToken,
  densityGap,
  type FooterSegment,
  renderFooter,
  renderFooterLine,
  thinkingColorToken,
} from "../src/footer.js";

/** Theme 桩: fg = `[token:text]`, 便于断言 token 与文本 */
const fakeTheme: Theme = {
  fg: (color, text) => `[${color}:${text}]`,
} as unknown as Theme;

const plainTheme: Theme = {
  fg: (_color, text) => text,
} as unknown as Theme;
const RE_GAP = /lefttext\s─{3,}\srighttext/;
const plain = (s: FooterSegment): FooterSegment => ({
  colorToken: null,
  text: s.text,
});

describe("3.1 Nordic footer line", () => {
  test("default slash separator", () => {
    const line = renderFooterLine(
      [
        plain({
          colorToken: null,
          text: "main",
        }),
        plain({
          colorToken: null,
          text: "zeta",
        }),
      ],
      "slash",
      "comfortable",
      120,
      fakeTheme,
    );
    expect(line).toBe("[muted:main][muted: ╱ ][muted:zeta]");
  });

  test("dot and pipe separators", () => {
    const segs = [
      plain({
        colorToken: null,
        text: "a",
      }),
      plain({
        colorToken: null,
        text: "b",
      }),
    ];
    expect(renderFooterLine(segs, "dot", "comfortable", 120, fakeTheme)).toContain(
      "[muted: · ]",
    );
    expect(renderFooterLine(segs, "pipe", "comfortable", 120, fakeTheme)).toContain(
      "[muted: │ ]",
    );
  });

  test("space separator uses density gap", () => {
    const segs = [
      plain({
        colorToken: null,
        text: "a",
      }),
      plain({
        colorToken: null,
        text: "b",
      }),
    ];
    expect(renderFooterLine(segs, "space", "compact", 120, fakeTheme)).toContain(
      "[muted:a]",
    );
    const compact = renderFooterLine(segs, "space", "compact", 120, fakeTheme);
    const spacious = renderFooterLine(segs, "space", "spacious", 120, fakeTheme);
    expect(compact.length).toBeLessThan(spacious.length);
    expect(densityGap("compact")).toBe(1);
    expect(densityGap("comfortable")).toBe(2);
    expect(densityGap("spacious")).toBe(3);
  });

  test("empty segments omitted, no double separators (spec scenario)", () => {
    // git 不可用(空串) → provider 和 cost 之间只有单一分隔
    const line = renderFooterLine(
      [
        plain({
          colorToken: null,
          text: "",
        }),
        plain({
          colorToken: null,
          text: "zeta",
        }),
        plain({
          colorToken: null,
          text: "$1.2",
        }),
      ],
      "slash",
      "comfortable",
      120,
      fakeTheme,
    );
    expect(line).toBe("[muted:zeta][muted: ╱ ][muted:$1.2]");
    expect(line.split("╱").length - 1).toBe(1);
  });

  test("all segments empty → empty line", () => {
    expect(
      renderFooterLine(
        [
          plain({
            colorToken: null,
            text: "",
          }),
        ],
        "slash",
        "comfortable",
        120,
        fakeTheme,
      ),
    ).toBe("");
  });

  test("oversized line drops trailing segments, stays within width", () => {
    const segs = [
      "aaaaaaaaaa",
      "bbbbbbbbbb",
      "cccccccccc",
      "dddddddddd",
    ].map((t) =>
      plain({
        colorToken: null,
        text: t,
      }),
    );
    const line = renderFooterLine(segs, "slash", "comfortable", 20, fakeTheme);
    expect(visibleWidth(line)).toBeLessThanOrEqual(20);
  });

  test("compresses cwd before dropping tail segments", () => {
    const line = renderFooterLine(
      [
        {
          colorToken: null,
          id: "git_branch",
          text: "main",
        },
        {
          colorToken: null,
          id: "cwd_path",
          text: "/very/long/project/path",
        },
        {
          colorToken: null,
          id: "model_name",
          text: "model",
        },
      ],
      "slash",
      "comfortable",
      24,
      plainTheme,
    );
    expect(visibleWidth(line)).toBeLessThanOrEqual(24);
    expect(line).toContain("main");
    expect(line).toContain("model");
    expect(line).toContain("…");
  });

  test("never discards the entire line when one segment can fit", () => {
    const line = renderFooterLine(
      [
        {
          colorToken: null,
          id: "cwd_path",
          text: "a long cwd path",
        },
      ],
      "slash",
      "comfortable",
      5,
      plainTheme,
    );
    expect(line).not.toBe("");
    expect(visibleWidth(line)).toBeLessThanOrEqual(5);
  });

  test("colorToken applied per segment", () => {
    const line = renderFooterLine(
      [
        {
          colorToken: "thinkingMedium",
          text: "medium",
        },
        {
          colorToken: "error",
          text: "80%",
        },
      ],
      "slash",
      "comfortable",
      120,
      fakeTheme,
    );
    expect(line).toBe("[thinkingMedium:medium][muted: ╱ ][error:80%]");
  });
});

describe("3.1 density row gap", () => {
  const rows = [
    {
      separator: "slash" as const,
      segments: [
        plain({
          colorToken: null,
          text: "r1",
        }),
      ],
    },
    {
      separator: "dot" as const,
      segments: [
        plain({
          colorToken: null,
          text: "r2",
        }),
      ],
    },
  ];

  test("compact = no blank lines", () => {
    expect(renderFooter(rows, "compact", 120, fakeTheme)).toHaveLength(2);
  });

  test("comfortable = one blank line between rows", () => {
    const lines = renderFooter(rows, "comfortable", 120, fakeTheme);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("");
  });

  test("spacious = two blank lines between rows", () => {
    const lines = renderFooter(rows, "spacious", 120, fakeTheme);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("");
  });
});

describe("3.2 fitBorder / shouldInstallEditor", () => {
  const id = (s: string) => s;

  test("four corners painted on border line", () => {
    const line = fitBorder("model", "think", 40, id);
    expect(line.startsWith("─ model ")).toBe(true);
    expect(line.endsWith(" think ─")).toBe(true);
    expect(visibleWidth(line)).toBe(40);
  });

  test("right slot truncated first when too long", () => {
    const line = fitBorder("aaa", "r".repeat(60), 20, id);
    expect(line.startsWith("─ aaa ")).toBe(true);
    expect(visibleWidth(line)).toBe(20);
    // right 侧内容被截掉了大半
    expect(line).not.toContain("r".repeat(60));
  });

  test("left slot truncated after right exhausted", () => {
    const line = fitBorder("l".repeat(60), "rr", 12, id);
    expect(visibleWidth(line)).toBe(12);
    // 窄宽度下 right 先被截空, 左侧再截到剩余宽度
    expect(line).not.toContain("rr");
    expect(line.startsWith("─")).toBe(true);
  });

  test("minimum gap of 3 kept", () => {
    const line = fitBorder("lefttext", "righttext", 30, id);
    const inner = line.slice(1, -1);
    expect(inner).toMatch(RE_GAP);
  });

  test("left slot survives when width allows", () => {
    const line = fitBorder("lefttext", "righttext", 40, id);
    expect(line).toContain("lefttext");
    expect(line).toContain("righttext");
  });

  test("empty slots skip install (spec scenario)", () => {
    expect(
      shouldInstallEditor({
        bottom_left: "none",
        bottom_right: "none",
        top_left: "none",
        top_right: "none",
      }),
    ).toBe(false);
    expect(
      shouldInstallEditor({
        bottom_left: "none",
        bottom_right: "none",
        top_left: "",
        top_right: "none",
      }),
    ).toBe(false);
  });

  test("any active slot installs", () => {
    expect(
      shouldInstallEditor({
        bottom_left: "none",
        bottom_right: "none",
        top_left: "model_name",
        top_right: "none",
      }),
    ).toBe(true);
    expect(
      shouldInstallEditor({
        bottom_left: "none",
        bottom_right: "context_compact",
        top_left: "none",
        top_right: "none",
      }),
    ).toBe(true);
  });

  test("plainBorder fills full width", () => {
    expect(plainBorder(10, id)).toBe("─".repeat(10));
  });

  test("renderBorderLine with both slots empty stays plain", () => {
    const line = renderBorderLine("", "", 8, fakeTheme);
    // fakeTheme 桩: fg 输出 [borderMuted:──…], 检查结构而非宽度
    expect(line).toBe("[borderMuted:────────]");
  });

  test("uses the thinking token for border lines", () => {
    const line = renderBorderLine("model", "think", 24, fakeTheme, "thinkingHigh");
    expect(line).toContain("[thinkingHigh:─]");
  });

  describe("3.3 theme tokens", () => {
    test("thinking level → token mapping", () => {
      expect(thinkingColorToken("off")).toBe("thinkingOff");
      expect(thinkingColorToken("high")).toBe("thinkingHigh");
      expect(thinkingColorToken("xhigh")).toBe("thinkingXhigh");
      expect(thinkingColorToken("max")).toBe("thinkingMax");
      expect(thinkingColorToken(null)).toBe("thinkingOff");
      expect(thinkingColorToken("bogus" as never)).toBe("thinkingOff");
    });

    test("context tiers → tokens", () => {
      expect(contextColorToken("ok")).toBe("success");
      expect(contextColorToken("warn")).toBe("warning");
      expect(contextColorToken("alert")).toBe("error");
      expect(contextColorToken("danger")).toBe("error");
    });
  });
});
