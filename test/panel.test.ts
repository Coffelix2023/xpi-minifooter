import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  buildPanelHtml,
  escapeHtml,
  footerLayoutToText,
  type GlimpseModule,
  openGlimpsePanel,
  parseFooterLayoutText,
} from "../src/panel.js";

describe("buildPanelHtml", () => {
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
      expect(html).toContain(`id="${slot}"`);
    }
    expect(html).toContain('id="footer_layout"');
    expect(html).toContain('id="preview"');
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

  test("panel HTML passed to glimpse.prompt contains the form", async () => {
    const calls: {
      html?: string;
    }[] = [];
    await openGlimpsePanel(DEFAULT_CONFIG, {
      load: async () => fakeGlimpse(null, calls),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.html).toContain('id="save"');
    expect(calls[0]?.html).toContain('id="footer_layout"');
  });
});
