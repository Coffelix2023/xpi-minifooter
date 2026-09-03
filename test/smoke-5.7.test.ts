import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.js";
import { applyPanelConfig } from "../src/index.js";
import { buildPanelHtml, openGlimpsePanel } from "../src/panel.js";
import {
  addEditorPadding,
  buildFooterRows,
  type SegmentInputs,
} from "../src/session.js";
import { buildModalLines, openTuiModal } from "../src/tui-modal.js";

const sessionSource = readFileSync(
  fileURLToPath(new URL("../src/session.ts", import.meta.url)),
  "utf8",
);
const EDITOR_HANDLE_INPUT = /class BorderStatusEditor[\s\S]*handleInput\(/;

function occupiedConfig() {
  const config = structuredClone(DEFAULT_CONFIG);
  config.editor_padding = "relaxed";
  config.border_slots.top_left = "git_branch";
  config.border_slots.top_right = "model_name";
  return config;
}

function inputs(): SegmentInputs {
  return {
    branchName: "main",
    contextPct: null,
    cwd: "/tmp/project",
    elapsedSeconds: 12,
    home: "/tmp",
    mcpCount: 0,
    modelNames: {},
    packageEntries: [],
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
}

describe("5.7 Pi smoke checklist", () => {
  test("Form and YAML Source tabs exist", () => {
    const html = buildPanelHtml(DEFAULT_CONFIG);
    expect(html).toContain('data-tab="formTab"');
    expect(html).toContain('data-tab="sourceTab"');
    expect(html).toContain('id="yaml_source"');
    expect(html).toContain("Insert template");
  });

  test("save failure stays visible and does not write", () => {
    const notifications: string[] = [];
    let saveCalls = 0;
    const ok = applyPanelConfig(
      {
        applyConfig: () => {
          throw new Error("must not apply");
        },
      },
      {
        outcome: "saved",
        rawYaml: "lang: fr",
      },
      (message) => notifications.push(message),
      {
        path: "/tmp/minifooter.yml",
        save: () => {
          saveCalls += 1;
        },
      },
    );
    expect(ok).toBe(false);
    expect(saveCalls).toBe(0);
    expect(notifications[0]).toContain("invalid");
  });

  test("relaxed padding inserts blank rows", () => {
    expect(
      addEditorPadding(
        [
          "top",
          "content",
          "bottom",
        ],
        "relaxed",
      ),
    ).toEqual([
      "top",
      "",
      "content",
      "",
      "bottom",
    ]);
  });

  test("border occupancy hides footer duplicates until slots are none", () => {
    const occupied = buildFooterRows(occupiedConfig(), inputs(), 120, () => null);
    expect(occupied[0]?.segments.map((segment) => segment.id)).not.toContain(
      "git_branch",
    );
    expect(occupied[0]?.segments.map((segment) => segment.id)).not.toContain(
      "model_name",
    );
    const restored = buildFooterRows(DEFAULT_CONFIG, inputs(), 120, () => null);
    expect(restored[0]?.segments.map((segment) => segment.id)).toEqual([
      "git_branch",
      "cwd_path",
      "model_name",
      "thinking_mode",
    ]);
  });

  test("TUI fallback shows padding and occupancy, then cancels", async () => {
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
    const shown = await openTuiModal(ctx as never, occupiedConfig());
    expect(shown).toBe(false);
    expect(overlay[0]).toMatchObject({
      overlay: true,
      overlayOptions: {
        anchor: "center",
        margin: {
          bottom: 4,
        },
      },
    });
    expect(rendered).toContain("editor_padding: relaxed");
    expect(rendered).toContain("Embedded in border: git_branch, model_name");
    expect(buildModalLines(occupiedConfig()).join("\n")).toContain(
      "[Esc/Enter/q] cancel",
    );
  });

  test("editor subclass keeps CustomEditor typing by not overriding handleInput", () => {
    expect(sessionSource).toContain("class BorderStatusEditor extends CustomEditor");
    expect(sessionSource).not.toMatch(EDITOR_HANDLE_INPUT);
  });

  test("Glimpse unavailable falls through without throwing", async () => {
    await expect(
      openGlimpsePanel(DEFAULT_CONFIG, {
        load: async () => null,
      }),
    ).resolves.toEqual({
      outcome: "unavailable",
    });
  });

  test("relaxed YAML still parses after a live save payload", () => {
    expect(parseConfig("editor_padding: relaxed")?.editor_padding).toBe("relaxed");
  });
});
