import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildModalLines } from "../src/tui-modal.js";

describe("buildModalLines (TUI fallback)", () => {
  test("renders all config groups", () => {
    const lines = buildModalLines(DEFAULT_CONFIG);
    const text = lines.join("\n");
    expect(text).toContain("lang: zh");
    expect(text).toContain("density: comfortable");
    expect(text).toContain("git: default");
    expect(text).toContain("warn 50 / alert 75 / danger 80");
    expect(text).toContain("tl none · tr none · bl none · br none");
    expect(text).toContain("items: [git_branch, provider, context_bar, cost]");
  });

  test("mentions the config file path for manual editing", () => {
    const text = buildModalLines(DEFAULT_CONFIG).join("\n");
    expect(text).toContain("minifooter.yml");
    expect(text).toContain("[Esc/q] close");
  });
});
