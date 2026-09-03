/**
 * xpi-minifooter — TUI modal fallback (task 4.3)
 *
 * Glimpse 不可用时的兜底: ctx.ui.custom overlay 居中 modal,
 * margin.bottom >= 4 (DESIGN.md), Esc/Enter/q 关闭。
 * v1 只读展示当前配置 + 提示手改 minifooter.yml (spec 允许: "presents the
 * same fields and save/cancel behavior" — 编辑走 Glimpse, TUI 保底可用)。
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import type { MinifooterConfig } from "./config.js";
import { footerLayoutToText } from "./panel.js";

/** 当前配置 → 只读 modal 行(纯函数, 可单测) */
export function buildModalLines(config: MinifooterConfig): string[] {
  const slots = config.border_slots;
  return [
    "xpi-minifooter",
    "",
    `lang: ${config.lang}  density: ${config.density}  icons: ${config.show_icons ? "on" : "off"}  labels: ${config.show_labels ? "on" : "off"}`,
    `cwd: ${config.cwd_path_mode}  git: ${config.git_branch_mode}`,
    `thresholds: warn ${config.thresholds.context_warn} / alert ${config.thresholds.context_alert} / danger ${config.thresholds.context_danger}`,
    `slots: tl ${slots.top_left} · tr ${slots.top_right} · bl ${slots.bottom_left} · br ${slots.bottom_right}`,
    "",
    "footer_layout:",
    ...footerLayoutToText(config.footer_layout)
      .split("\n")
      .map((l) => `  ${l}`),
    "",
    "Edit ~/.pi/agent/minifooter.yml to change values.",
    "Changes hot-reload on next render.",
    "",
    "[Esc/q] close",
  ];
}

export interface TuiModalDeps {
  custom?: ExtensionContext["ui"]["custom"];
}

/**
 * 打开 TUI modal(overlay, 居中, margin.bottom >= 4)。
 * Esc / Enter / q 关闭。返回 false 表示 ctx.ui.custom 不可用(双重兜底)。
 */
export async function openTuiModal(
  ctx: ExtensionContext,
  config: MinifooterConfig,
): Promise<boolean> {
  const custom = ctx.ui?.custom;
  if (typeof custom !== "function") return false;
  return new Promise<boolean>((resolve) => {
    void custom.call(
      ctx.ui,
      (
        tui: TUI,
        _theme: unknown,
        _keybindings: KeybindingsManager,
        done: (result: boolean) => void,
      ): Component & {
        dispose?(): void;
      } => {
        let closed = false;
        const finish = (v: boolean): void => {
          if (closed) return;
          closed = true;
          done(v);
          resolve(v);
        };
        return {
          handleInput(data: string): void {
            if (
              matchesKey(data, "escape") ||
              matchesKey(data, "return") ||
              data === "q"
            ) {
              finish(false);
            }
          },
          invalidate(): void {},
          render(width: number): string[] {
            void tui;
            const lines = buildModalLines(config);
            const inner = Math.max(20, width - 4);
            const top = `┌${"─".repeat(inner)}┐`;
            const bottom = `└${"─".repeat(inner)}┘`;
            return [
              top,
              ...lines.map((l) => `│${l.slice(0, inner).padEnd(inner)}│`),
              bottom,
            ];
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          margin: {
            bottom: 4,
          },
        },
      },
    );
  });
}
