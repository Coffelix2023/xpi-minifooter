/**
 * xpi-minifooter — editor 四方位边框 (task 3.2, 3.3)
 *
 * fitBorder: 复用官方 border-status-editor 算法(先截 right, 再截 left, 最小 gap 3)。
 * shouldInstallEditor: 全部槽位 none/空 → 不接管编辑器。
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type BorderSlotId = "top_left" | "top_right" | "bottom_left" | "bottom_right";

/** fitBorder: 左右文本嵌入边框线;超宽先截右, 再截左, 最小 gap 3 */
export function fitBorder(
  left: string,
  right: string,
  width: number,
  border: (text: string) => string,
  fill: (text: string) => string = border,
): string {
  if (width <= 0) return "";
  if (width === 1) return border("─");

  let leftText = left.trim() === "" ? "" : ` ${left} `;
  let rightText = right.trim() === "" ? "" : ` ${right} `;
  const fixedWidth = 2;
  const minimumGap = 3;

  while (
    fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap >
      width &&
    visibleWidth(rightText) > 0
  ) {
    rightText = truncateToWidth(
      rightText,
      Math.max(0, visibleWidth(rightText) - 1),
      "",
    );
  }
  while (
    fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap >
      width &&
    visibleWidth(leftText) > 0
  ) {
    leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
  }

  const gapWidth = Math.max(
    0,
    width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText),
  );
  return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
}

export interface BorderSlots {
  bottom_left: string;
  bottom_right: string;
  top_left: string;
  top_right: string;
}

/** 3.2: 至少一个槽位非空(非 none/空串)才安装 editor */
export function shouldInstallEditor(slots: BorderSlots): boolean {
  return Object.values(slots).some((v) => v.trim() !== "" && v !== "none");
}

/** 无边框时的行(不动边框) */
export function plainBorder(width: number, border: (text: string) => string): string {
  if (width <= 0) return "";
  return border("─".repeat(width));
}

/** 渲染边框行: 有槽位走 fitBorder, 无槽位保持素线 */
export function renderBorderLine(
  left: string,
  right: string,
  width: number,
  theme: Theme,
  colorToken: ThemeColor = "borderMuted",
): string {
  const border = (text: string) => theme.fg(colorToken, text);
  if (left.trim() === "" && right.trim() === "") return plainBorder(width, border);
  return fitBorder(left, right, width, border);
}
