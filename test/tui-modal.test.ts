import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, type MinifooterConfig } from "../src/config.js";
import { buildModalLines, openTuiModal } from "../src/tui-modal.js";

function configWithSlots(
  slots: Partial<MinifooterConfig["border_slots"]>,
  editor_padding: MinifooterConfig["editor_padding"] = "relaxed",
): MinifooterConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    editor_padding,
    border_slots: {
      ...DEFAULT_CONFIG.border_slots,
      ...slots,
    },
  };
}

describe("buildModalLines (TUI fallback)", () => {
  test("renders all config groups", () => {
    const lines = buildModalLines(DEFAULT_CONFIG);
    const text = lines.join("\n");
    expect(text).toContain("语言: zh");
    expect(text).toContain("密度: comfortable");
    expect(text).toContain("分支: default");
    expect(text).toContain("编辑器边距: default");
    expect(text).toContain("警告 50 / 提醒 75 / 危险 80");
    expect(text).toContain("左上 none · 右上 none · 左下 none · 右下 none");
    expect(text).toContain("边框未嵌入参数。");
    expect(text).toContain("items: [git_branch, cwd_path, model_name, thinking_mode]");
    expect(text).toContain("items: [context_bar, tokens, cost, session_time]");
  });

  test("renders English labels for lang=en", () => {
    const text = buildModalLines({
      ...structuredClone(DEFAULT_CONFIG),
      lang: "en",
    }).join("\n");
    expect(text).toContain("lang: en");
    expect(text).toContain("editor_padding: default");
    expect(text).toContain("warn 50 / alert 75 / danger 80");
    expect(text).toContain("No parameters embedded in border.");
  });

  test("mentions the config file path for manual editing", () => {
    const text = buildModalLines(DEFAULT_CONFIG).join("\n");
    expect(text).toContain("minifooter.yml");
    expect(text).toContain("[Esc/Enter/q] 取消");
  });

  test("shows editor_padding and occupied border parameters", () => {
    const text = buildModalLines(
      configWithSlots({
        bottom_right: "cwd_path",
        top_left: "git_branch",
      }),
    ).join("\n");
    expect(text).toContain("编辑器边距: relaxed");
    expect(text).toContain(
      "已嵌入边框: git_branch, cwd_path。footer 中的重复项将隐藏。",
    );
  });
  test("shows multi-slot, native footer, and context token state", () => {
    const text = buildModalLines(
      {
        ...structuredClone(DEFAULT_CONFIG),
        native_footer: true,
        border_slots: {
          ...structuredClone(DEFAULT_CONFIG.border_slots),
          top_left: [
            "git_branch",
            "model_name",
          ],
        },
      },
      {
        contextTokens: 12_000,
        contextWindow: 1_000_000,
        nativeStatuses: [
          "● plugin:on",
        ],
      },
    ).join("\n");
    expect(text).toContain("左上 git_branch, model_name");
    expect(text).toContain("native footer: ● plugin:on");
    expect(text).toContain("context tokens: 12k/1M");
  });
});

describe("openTuiModal fallback mock", () => {
  test("render output contains editor_padding and occupancy", async () => {
    let rendered = "";
    const overlay: unknown[] = [];
    const ctx = {
      ui: {
        custom(
          factory: (
            tui: unknown,
            theme: unknown,
            keys: unknown,
            done: (v: boolean) => void,
          ) => {
            handleInput(data: string): void;
            render(width: number): string[];
          },
          options: unknown,
        ) {
          overlay.push(options);
          const component = factory({}, {}, {}, () => {});
          rendered = component.render(80).join("\n");
          component.handleInput("q");
        },
      },
    };
    const shown = await openTuiModal(
      ctx as never,
      configWithSlots(
        {
          top_left: "model_name",
        },
        "relaxed",
      ),
    );
    expect(shown).toBe(false);
    expect(overlay[0]).toEqual({
      overlay: true,
      overlayOptions: {
        anchor: "center",
        margin: {
          bottom: 4,
        },
      },
    });
    expect(rendered).toContain("编辑器边距: relaxed");
    expect(rendered).toContain("已嵌入边框: model_name。footer 中的重复项将隐藏。");
  });
});
