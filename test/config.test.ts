import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/config.js";

describe("config schema (task 1.2)", () => {
  test("missing file loads defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "minifooter-"));
    const result = loadConfig(join(dir, "minifooter.yml"));
    expect(result).not.toBeNull();
    expect(result?.mtime).toBeNull();
    expect(result?.config).toEqual(DEFAULT_CONFIG);
    expect(result?.config.footer_layout).toEqual([
      {
        separator: "slash",
        items: [
          "git_branch",
          "cwd_path",
          "model_name",
          "thinking_mode",
        ],
      },
      {
        separator: "slash",
        items: [
          "context_bar",
          "tokens",
          "cost",
          "session_time",
        ],
      },
    ]);
  });

  test("valid yaml parses into config", () => {
    const yaml = [
      "lang: en",
      "density: compact",
      "show_icons: false",
      "git_branch_mode: mini",
      "border_slots: { top_left: context_bar, top_right: none, bottom_left: none, bottom_right: none }",
      "footer_layout:",
      "  - items: [git_branch, cost]",
      "    separator: dot",
      "thresholds: { context_warn: 40, context_alert: 70, context_danger: 90 }",
    ].join("\n");
    const config = parseConfig(yaml);
    expect(config).not.toBeNull();
    expect(config?.lang).toBe("en");
    expect(config?.border_slots.top_left).toBe("context_bar");
    expect(config?.footer_layout[0]?.separator).toBe("dot");
  });
  test("editor padding defaults to default and parses relaxed", () => {
    expect(parseConfig("lang: en")?.editor_padding).toBe("default");
    expect(parseConfig("editor_padding: relaxed")?.editor_padding).toBe("relaxed");
  });
  test("invalid editor padding returns null", () => {
    expect(parseConfig("editor_padding: roomy")).toBeNull();
  });

  test("duplicate border slots return null", () => {
    expect(
      parseConfig("border_slots: { top_left: git_branch, top_right: git_branch }"),
    ).toBeNull();
  });
  test("border and footer duplicates remain valid", () => {
    const config = parseConfig(
      "border_slots: { top_left: git_branch }\nfooter_layout:\n  - items: [git_branch, cwd_path]",
    );
    expect(config?.border_slots.top_left).toBe("git_branch");
    expect(config?.footer_layout[0]?.items).toEqual([
      "git_branch",
      "cwd_path",
    ]);
  });

  test("invalid yaml returns null", () => {
    expect(parseConfig("lang: [unclosed")).toBeNull();
  });

  test("bad enum returns null", () => {
    expect(parseConfig("lang: fr")).toBeNull();
    expect(parseConfig("style: powerline")).toBeNull();
    expect(
      parseConfig("footer_layout:\n  - items: [nope]\n    separator: slash"),
    ).toBeNull();
  });

  test("unordered thresholds return null", () => {
    expect(
      parseConfig(
        "thresholds: { context_warn: 80, context_alert: 50, context_danger: 90 }",
      ),
    ).toBeNull();
  });

  test("out-of-range thresholds return null", () => {
    expect(
      parseConfig(
        "thresholds: { context_warn: 40, context_alert: 70, context_danger: 101 }",
      ),
    ).toBeNull();
  });

  test("partial file keeps defaults for unwritten keys", () => {
    const config = parseConfig("lang: en");
    expect(config?.lang).toBe("en");
    expect(config?.density).toBe(DEFAULT_CONFIG.density);
    expect(config?.thresholds.context_warn).toBe(50);
  });
});
