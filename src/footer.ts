/**
 * xpi-minifooter — Nordic footer Component (task 3.1, 3.3)
 *
 * 北欧极简: 无 Powerline 色块/徽章芯片, 分隔符 `╱`/`·`/`│`/空隙,
 * 空段省略不留连续分隔符, 宽度全部走 visibleWidth/truncateToWidth。
 * thinking / context 颜色接 Pi theme token(3.3)。
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
  /** 参数 id;用于溢出时识别可压缩段 */
  id?: string;
  text: string;
}

function renderParts(
  segments: readonly FooterSegment[],
  separator: string,
  theme: Theme,
  width: number,
  compressed: boolean,
): string {
  const parts = segments.map((seg) => {
    const text =
      compressed && (seg.id === "cwd_path" || seg.id === "packages")
        ? truncateToWidth(seg.text, Math.max(4, Math.floor(width / 4)), "…")
        : seg.text;
    return seg.colorToken === null
      ? theme.fg("muted", text)
      : theme.fg(seg.colorToken, text);
  });
  return parts.join(theme.fg("muted", separator));
}

function fitSegments(
  segments: readonly FooterSegment[],
  separator: string,
  theme: Theme,
  width: number,
  compressed: boolean,
): string {
  let kept = segments.filter((seg) => seg.text.trim() !== "");
  let line = renderParts(kept, separator, theme, width, compressed);
  while (kept.length > 1 && visibleWidth(line) > width) {
    kept = kept.slice(0, -1);
    line = renderParts(kept, separator, theme, width, compressed);
  }
  return truncateToWidth(line, width, "");
}

/** 拼一行: 先压缩 cwd/packages，再从尾部逐段丢弃，永不溢出。 */
export function renderFooterLine(
  segments: readonly FooterSegment[],
  separator: Separator,
  density: Density,
  width: number,
  theme: Theme,
): string {
  const sep =
    separator === "space" ? " ".repeat(densityGap(density)) : SEPARATORS[separator];
  const nonEmpty = segments.filter((seg) => seg.text.trim() !== "");
  if (nonEmpty.length === 0 || width <= 0) return "";
  const normal = renderParts(nonEmpty, sep, theme, width, false);
  if (visibleWidth(normal) <= width) return normal;
  // ponytail: only cwd/packages are compressible in v1.
  return fitSegments(nonEmpty, sep, theme, width, true);
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
