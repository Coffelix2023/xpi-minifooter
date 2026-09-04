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
    expect(config?.border_slots.top_left).toEqual([
      "context_bar",
    ]);
    expect(config?.footer_layout[0]?.separator).toBe("dot");
  });
  test("editor padding defaults to default and parses relaxed", () => {
    expect(parseConfig("lang: en")?.editor_padding).toBe("default");
    expect(parseConfig("editor_padding: relaxed")?.editor_padding).toBe("relaxed");
  });
  test("invalid editor padding returns null", () => {
    expect(parseConfig("editor_padding: compact")).toBeNull();
  });

  test("allows duplicates across border slots", () => {
    const config = parseConfig(
      "border_slots: { top_left: git_branch, top_right: git_branch }",
    );
    expect(config?.border_slots.top_left).toEqual([
      "git_branch",
    ]);
    expect(config?.border_slots.top_right).toEqual([
      "git_branch",
    ]);
  });
  test("rejects duplicates within one border slot", () => {
    expect(
      parseConfig("border_slots:\n  top_left: [git_branch, git_branch]"),
    ).toBeNull();
  });
  test("border and footer duplicates remain valid", () => {
    const config = parseConfig(
      "border_slots: { top_left: git_branch }\nfooter_layout:\n  - items: [git_branch, cwd_path]",
    );
    expect(config?.border_slots.top_left).toEqual([
      "git_branch",
    ]);
    expect(config?.footer_layout[0]?.items).toEqual([
      "git_branch",
      "cwd_path",
    ]);
  });

  test("parses two border parameters and rejects more than two", () => {
    expect(
      parseConfig(
        "border_slots:\n  top_left: [git_branch, cwd_path]\n  top_right: none",
      )?.border_slots.top_left,
    ).toEqual([
      "git_branch",
      "cwd_path",
    ]);
    expect(
      parseConfig("border_slots:\n  top_left: [git_branch, cwd_path, model_name]"),
    ).toBeNull();
  });

  test("rejects removed icon, label, and native footer fields", () => {
    expect(parseConfig("icons: { git_branch: '' }")).toBeNull();
    expect(parseConfig("labels: { git_branch: Branch }")).toBeNull();
    expect(parseConfig("native_footer: true")).toBeNull();
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
  test("fills defaults for partial footer layout rows", () => {
    const config = parseConfig("footer_layout:\n  - items: [cwd_path]");
    expect(config?.footer_layout[0]?.items).toEqual([
      "cwd_path",
    ]);
    expect(config?.footer_layout[0]?.separator).toBe("slash");
  });
});
