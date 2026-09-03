/**
 * xpi-minifooter — Nordic footer Component (task 3.1, 3.3)
 *
 * 北欧极简: 无 Powerline 色块/徽章芯片, 分隔符 `╱`/`·`/`│`/空隙,
 * 空段省略不留连续分隔符, 宽度全部走 visibleWidth/truncateToWidth。
 * thinking / context 颜色接 Pi theme token(3.3)。
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { MinifooterConfig } from "./config.js";
import type { SegmentContext, ThinkingLevel } from "./segments.js";
import { contextLevel } from "./segments.js";

export type Separator = "slash" | "dot" | "pipe" | "space";
export type Density = "compact" | "comfortable" | "spacious";

const SEPARATORS = {
  dot: " · ",
  pipe: " │ ",
  slash: " ╱ ",
} as const;

/** density → space 分隔的实际空隙 */
export function densityGap(density: Density): number {
  if (density === "compact") return 1;
  return density === "comfortable" ? 2 : 3;
}

/** footer 行间空行数(spec: compact=0, comfortable=1, spacious=2) */
export function rowGap(density: Density): number {
  if (density === "compact") return 0;
  return density === "comfortable" ? 1 : 2;
}

export type Level = "ok" | "warn" | "alert" | "danger";

/** context 档位 → theme token */
export function contextColorToken(level: Level | null): ThemeColor {
  switch (level) {
    case "danger":
      return "error";
    case "alert":
      return "error";
    case "warn":
      return "warning";
    default:
      return "success";
  }
}

/** thinking level → theme token(未知 level → thinkingOff) */
export function thinkingColorToken(level: ThinkingLevel | null): ThemeColor {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    default:
      return "thinkingOff";
  }
}

export interface FooterSegment {
  /** 着色 token;null → muted(元数据) */
  colorToken: ThemeColor | null;
  text: string;
}

/**
 * 拼一行: 过滤空段, 单一分隔符, 尾行截断到 width。
 * 着色: 段文本先上色再 join(sep), sep 用 muted。
 */
export function renderFooterLine(
  segments: readonly FooterSegment[],
  separator: Separator,
  density: Density,
  width: number,
  theme: Theme,
): string {
  const sep =
    separator === "space" ? " ".repeat(densityGap(density)) : SEPARATORS[separator];
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.text.trim() === "") continue;
    const colored =
      seg.colorToken === null
        ? theme.fg("muted", seg.text)
        : theme.fg(seg.colorToken, seg.text);
    parts.push(colored);
  }
  const sepColored = theme.fg("muted", sep);
  const line = parts.join(sepColored);
  const totalWidth = parts.length === 0 ? 0 : visibleWidth(line);
  if (totalWidth <= width) return line;
  // 超宽: 逐段从尾部丢弃, 保证不溢出
  let kept: string[] = parts;
  while (kept.length > 1 && visibleWidth(kept.join(sepColored)) > width) {
    kept = kept.slice(0, -1);
  }
  return kept.join(sepColored);
}

export interface FooterRowData {
  segments: FooterSegment[];
  separator: Separator;
}

/** 全部行渲染(含 density 行间空行) */
export function renderFooter(
  rows: readonly FooterRowData[],
  density: Density,
  width: number,
  theme: Theme,
): string[] {
  const lines: string[] = [];
  const gap = rowGap(density);
  rows.forEach((row, i) => {
    if (i > 0 && gap > 0) {
      for (let g = 0; g < gap; g++) lines.push("");
    }
    lines.push(renderFooterLine(row.segments, row.separator, density, width, theme));
  });
  return lines;
}

/** 便捷: context 百分比 → 着色 token(接 2.6 contextLevel) */
export function contextTokenFor(
  pct: number | null,
  thresholds: MinifooterConfig["thresholds"],
): ThemeColor {
  return contextColorToken(contextLevel(pct, thresholds));
}

/** 便捷: context 段数据(SegmentContext 不变, 仅取宽度) */
export function ctxWidth(ctx: SegmentContext): number {
  return ctx.width;
}
