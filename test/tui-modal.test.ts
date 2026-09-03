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
    expect(text).toContain("lang: zh");
    expect(text).toContain("density: comfortable");
    expect(text).toContain("git: default");
    expect(text).toContain("editor_padding: default");
    expect(text).toContain("warn 50 / alert 75 / danger 80");
    expect(text).toContain("tl none · tr none · bl none · br none");
    expect(text).toContain("No parameters embedded in border.");
    expect(text).toContain("items: [git_branch, cwd_path, model_name, thinking_mode]");
    expect(text).toContain("items: [context_bar, tokens, cost, session_time]");
  });

  test("mentions the config file path for manual editing", () => {
    const text = buildModalLines(DEFAULT_CONFIG).join("\n");
    expect(text).toContain("minifooter.yml");
    expect(text).toContain("[Esc/Enter/q] cancel");
  });

  test("shows editor_padding and occupied border parameters", () => {
    const text = buildModalLines(
      configWithSlots({
        bottom_right: "cwd_path",
        top_left: "git_branch",
      }),
    ).join("\n");
    expect(text).toContain("editor_padding: relaxed");
    expect(text).toContain(
      "Embedded in border: git_branch, cwd_path. Footer duplicates hidden.",
    );
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
    expect(rendered).toContain("editor_padding: relaxed");
    expect(rendered).toContain(
      "Embedded in border: model_name. Footer duplicates hidden.",
    );
  });
});
