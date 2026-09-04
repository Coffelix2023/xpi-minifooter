/**
 * xpi-minifooter — TUI modal fallback (task 4.3, 4.8)
 *
 * Glimpse 不可用时的兜底: ctx.ui.custom overlay 居中 modal,
 * margin.bottom >= 4 (DESIGN.md), Esc/Enter/q 关闭。
 * v1 只读展示当前配置 + 提示手改 minifooter.yml (spec 允许: "presents the
 * same fields and save/cancel behavior" — 编辑走 Glimpse, TUI 保底可用)。
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { type MinifooterConfig, slotValues } from "./config.js";
import { footerLayoutToText, UI_TEXT } from "./panel.js";
import { formatContextTokens } from "./segments.js";

const SLOT_ORDER = [
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
] as const;

function occupancyHint(
  lang: "zh" | "en",
  slots: MinifooterConfig["border_slots"],
): string {
  const t = UI_TEXT[lang];
  const used = SLOT_ORDER.flatMap((key) => slotValues(slots[key])).filter(
    (id) => id !== "none",
  );
  return used.length > 0
    ? t.occupancyUsed.replace("__USED__", used.join(", "))
    : t.occupancyEmpty;
}

/** 当前配置 → 只读 modal 行(纯函数, 可单测) */
export function buildModalLines(
  config: MinifooterConfig,
  options: {
    contextTokens?: number | null;
    contextWindow?: number | null;
    nativeStatuses?: readonly string[];
  } = {},
): string[] {
  const slots = config.border_slots;
  const t = UI_TEXT[config.lang];
  const L = t.modalLabels;
  const nativeFooterLine = options.nativeStatuses?.length
    ? `native footer: ${options.nativeStatuses.join(" ")}`
    : "native footer: none";
  return [
    "xpi-minifooter",
    "",
    `${L.lang}: ${config.lang}  ${L.density}: ${config.density}  ${L.icons}: ${config.show_icons ? L.on : L.off}  ${L.labels}: ${config.show_labels ? L.on : L.off}  native_footer: ${config.native_footer_layout.length > 0 ? L.on : L.off}`,
    `${L.cwd}: ${config.cwd_path_mode}  ${L.git}: ${config.git_branch_mode}  ${L.editor_padding}: ${config.editor_padding}`,
    `${L.thresholds}: ${L.warn} ${config.thresholds.context_warn} / ${L.alert} ${config.thresholds.context_alert} / ${L.danger} ${config.thresholds.context_danger}`,
    `${L.slots}: ${L.tl} ${slotValues(slots.top_left).join(", ")} · ${L.tr} ${slotValues(slots.top_right).join(", ")} · ${L.bl} ${slotValues(slots.bottom_left).join(", ")} · ${L.br} ${slotValues(slots.bottom_right).join(", ")}`,
    options.contextTokens !== null &&
    options.contextTokens !== undefined &&
    options.contextWindow
      ? `context tokens: ${formatContextTokens(options.contextTokens, options.contextWindow)}`
      : "context tokens: ~",
    nativeFooterLine,
    occupancyHint(config.lang, slots),
    ...footerLayoutToText(config.footer_layout)
      .split("\n")
      .map((l) => `  ${l}`),
    "",
    t.modalEditHint,
    t.modalReloadHint,
    "",
    t.modalCancel,
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
            const usage =
              typeof ctx.getContextUsage === "function"
                ? ctx.getContextUsage()
                : undefined;
            const lines = buildModalLines(config, {
              contextTokens: usage?.tokens,
              contextWindow: usage?.contextWindow,
              nativeStatuses: [],
            });
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
