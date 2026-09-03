/**
 * xpi-minifooter — 配置核心 (task 1.2)
 *
 * 职责: minifooter.yml 路径解析、typebox schema、默认值、加载与校验。
 * fail-closed 加载 / canonical save(0600)。
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import Type from "typebox";
import { Compile } from "typebox/compile";
import { parse, stringify } from "yaml";

/** 12 个参数 id(minifooter-segments 契约, task 2.x 填充渲染器) */
export const PARAMETER_IDS = [
  "model_name",
  "provider",
  "thinking_mode",
  "git_branch",
  "cwd_path",
  "context_bar",
  "context_compact",
  "tokens",
  "cost",
  "session_time",
  "packages",
  "mcp_skills",
] as const;

export type ParameterId = (typeof PARAMETER_IDS)[number];

const borderSlotSchema = Type.Union([
  ...PARAMETER_IDS.map((id) => Type.Literal(id)),
  Type.Literal("none"),
]);

// 所有字段 Optional: 用户文件只写子集, 缺省由 DEFAULT_CONFIG 补齐(默认值在代码)
export const configSchema = Type.Object({
  border_slots: Type.Optional(
    Type.Object({
      bottom_left: Type.Optional(borderSlotSchema),
      bottom_right: Type.Optional(borderSlotSchema),
      top_left: Type.Optional(borderSlotSchema),
      top_right: Type.Optional(borderSlotSchema),
    }),
  ),
  cwd_path_mode: Type.Optional(
    Type.Union([
      Type.Literal("basename"),
      Type.Literal("relative"),
      Type.Literal("full"),
    ]),
  ),
  density: Type.Optional(
    Type.Union([
      Type.Literal("compact"),
      Type.Literal("comfortable"),
      Type.Literal("spacious"),
    ]),
  ),
  footer_layout: Type.Optional(
    Type.Array(
      Type.Object({
        items: Type.Optional(
          Type.Array(Type.Union(PARAMETER_IDS.map((id) => Type.Literal(id)))),
        ),
        separator: Type.Optional(
          Type.Union([
            Type.Literal("slash"),
            Type.Literal("dot"),
            Type.Literal("pipe"),
            Type.Literal("space"),
          ]),
        ),
      }),
    ),
  ),
  git_branch_mode: Type.Optional(
    Type.Union([
      Type.Literal("mini"),
      Type.Literal("default"),
      Type.Literal("full"),
    ]),
  ),
  lang: Type.Optional(
    Type.Union([
      Type.Literal("zh"),
      Type.Literal("en"),
    ]),
  ),
  show_icons: Type.Optional(Type.Boolean()),
  show_labels: Type.Optional(Type.Boolean()),
  style: Type.Optional(Type.Literal("minimalist")),
  thresholds: Type.Optional(
    Type.Object({
      context_alert: Type.Optional(
        Type.Number({
          maximum: 100,
          minimum: 0,
        }),
      ),
      context_danger: Type.Optional(
        Type.Number({
          maximum: 100,
          minimum: 0,
        }),
      ),
      context_warn: Type.Optional(
        Type.Number({
          maximum: 100,
          minimum: 0,
        }),
      ),
    }),
  ),
});

export interface MinifooterConfig {
  border_slots: Record<
    "top_left" | "top_right" | "bottom_left" | "bottom_right",
    ParameterId | "none"
  >;
  cwd_path_mode: "basename" | "relative" | "full";
  density: "compact" | "comfortable" | "spacious";
  footer_layout: {
    items: ParameterId[];
    separator: "slash" | "dot" | "pipe" | "space";
  }[];
  git_branch_mode: "mini" | "default" | "full";
  lang: "zh" | "en";
  show_icons: boolean;
  show_labels: boolean;
  style: "minimalist";
  thresholds: {
    context_warn: number;
    context_alert: number;
    context_danger: number;
  };
}

export const DEFAULT_CONFIG: MinifooterConfig = {
  cwd_path_mode: "basename",
  density: "comfortable",
  git_branch_mode: "default",
  lang: "zh",
  show_icons: true,
  show_labels: false,
  style: "minimalist",
  border_slots: {
    bottom_left: "none",
    bottom_right: "none",
    top_left: "none",
    top_right: "none",
  },
  footer_layout: [
    {
      separator: "slash",
      items: [
        "git_branch",
        "provider",
        "context_bar",
        "cost",
      ],
    },
  ],
  thresholds: {
    context_alert: 75,
    context_danger: 80,
    context_warn: 50,
  },
};

/** ~/.pi/agent/minifooter.yml 绝对路径 */
export function configPath(): string {
  return join(getAgentDir(), "minifooter.yml");
}

/**
 * 解析并校验 YAML 文本。
 * 解析失败 / 枚举非法 / 阈值乱序 → null(调用方按 fail-closed 保留上一份)。
 */
export function parseConfig(raw: string): MinifooterConfig | null {
  let data: unknown;
  try {
    data = parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object") return null;
  const validator = Compile(configSchema);
  if (!validator.Check(data)) return null;
  // 浅合并: 文件子集 + 代码默认值(schema 全部字段 Optional, 未写的 key 用默认)
  const partial = data as Partial<MinifooterConfig>;
  const merged: MinifooterConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    ...partial,
    border_slots: {
      ...DEFAULT_CONFIG.border_slots,
      ...partial.border_slots,
    },
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...partial.thresholds,
    },
  };
  // 阈值必须严格递增: warn < alert < danger
  const t = merged.thresholds;
  if (!(t.context_warn < t.context_alert && t.context_alert < t.context_danger))
    return null;
  return merged;
}

export interface LoadedConfig {
  config: MinifooterConfig;
  /** 文件 mtime(ms);文件不存在时为 null */
  mtime: number | null;
}

/**
 * mtime 探测。不存在或不可访问 → null(下次渲染重试)。
 */
export function statMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * 从磁盘加载配置。
 * - 文件缺失 → 默认值(mtime null)
 * - 读取/解析/校验失败 → null(调用方 keep-last-valid)
 */
export function loadConfig(path: string): LoadedConfig | null {
  let mtime: number | null;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      mtime: null,
    };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const config = parseConfig(raw);
  return config === null
    ? null
    : {
        config,
        mtime,
      };
}

/**
 * 校验通过的配置序列化为 canonical YAML(键排序, 无注释)。
 * v1 不回写用户注释(design.md 决策 1)。
 */
export function serializeConfig(config: MinifooterConfig): string {
  return stringify(config, {
    sortMapEntries: true,
  });
}

/**
 * canonical YAML 写入 minifooter.yml。
 * 创建时权限 0600(agent 目录私有配置);已存在则保留原 inode 权限。
 */
export function saveConfig(path: string, config: MinifooterConfig): void {
  const yaml = serializeConfig(config);
  try {
    writeFileSync(path, yaml, {
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    // 已存在(EEXIST)或写失败: 覆盖写, 保留现有文件权限
    writeFileSync(path, yaml);
  }
}
