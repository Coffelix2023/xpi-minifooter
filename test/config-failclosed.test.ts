import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_CONFIG,
  loadConfig,
  parseConfig,
  saveConfig,
  serializeConfig,
} from "../src/config.js";

function tmpFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "minifooter-"));
  const path = join(dir, "minifooter.yml");
  if (content !== undefined) writeFileSync(path, content);
  return path;
}

describe("fail-closed load (task 1.3)", () => {
  test("invalid yaml keeps last valid config", () => {
    const path = tmpFile("lang: en");
    const last = loadConfig(path);
    expect(last?.config.lang).toBe("en");
    // 用户写坏文件 → loadConfig 返回 null, 调用方保留 last.config
    writeFileSync(path, "lang: [unclosed");
    expect(loadConfig(path)).toBeNull();
    expect(last?.config.lang).toBe("en");
  });

  test("bad enum keeps last valid config", () => {
    const path = tmpFile("lang: en");
    const last = loadConfig(path);
    expect(last?.config.lang).toBe("en");
    writeFileSync(path, "git_branch_mode: turbo");
    expect(loadConfig(path)).toBeNull();
    expect(last?.config.lang).toBe("en");
  });

  test("unordered thresholds rejected", () => {
    expect(
      loadConfig(
        tmpFile(
          "thresholds: { context_warn: 80, context_alert: 50, context_danger: 90 }",
        ),
      ),
    ).toBeNull();
  });

  test("missing file falls back to defaults", () => {
    const result = loadConfig(join(tmpdir(), "definitely-missing.yml"));
    expect(result?.config).toEqual(DEFAULT_CONFIG);
    expect(result?.mtime).toBeNull();
  });
});

describe("canonical save (task 1.4)", () => {
  test("round-trip: save then load returns same values", () => {
    const path = tmpFile();
    const parsed = parseConfig(
      "lang: en\ndensity: compact\nthresholds: { context_warn: 40, context_alert: 70, context_danger: 90 }",
    );
    if (parsed === null) throw new Error("fixture must parse");
    saveConfig(path, parsed);
    const reloaded = loadConfig(path);
    expect(reloaded?.config).toEqual(parsed);
    expect(reloaded?.mtime).not.toBeNull();
  });

  test("canonical dump is key-sorted stable yaml", () => {
    const yaml = serializeConfig(DEFAULT_CONFIG);
    expect(yaml.startsWith("border_slots:")).toBe(true);
    expect(parseConfig(yaml)).toEqual(DEFAULT_CONFIG);
  });

  test("new file gets mode 0600", () => {
    const path = tmpFile();
    saveConfig(path, DEFAULT_CONFIG);
    // umask 可能影响, 显式校验 owner-read/write 且 group/other 无写
    const mode = statSync(path).mode & 0o777;
    expect(mode & 0o077).toBe(0);
    expect(mode & 0o600).toBe(0o600);
  });

  test("existing file keeps its permissions", () => {
    const path = tmpFile("lang: zh");
    chmodSync(path, 0o644);
    saveConfig(path, DEFAULT_CONFIG);
    expect(statSync(path).mode & 0o777).toBe(0o644);
  });
});
