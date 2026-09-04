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
  "model_id",
  "provider",
  "thinking_mode",
  "git_branch",
  "cwd_path",
  "context_bar",
  "context_compact",
  "tokens",
  "cost",
  "session_time",
  "native_footer",
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
  editor_padding: Type.Optional(
    Type.Union([
      Type.Literal("default"),
      Type.Literal("relaxed"),
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
  editor_padding: "default" | "relaxed";
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
  editor_padding: "default",
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
export interface ConfigParseResult {
  config: MinifooterConfig | null;
  error: string | null;
}

/** 解析配置并返回可展示的非敏感错误信息。 */
export function parseConfigWithError(raw: string): ConfigParseResult {
  let data: unknown;
  try {
    data = parse(raw);
  } catch (error) {
    const line =
      typeof error === "object" &&
      error !== null &&
      "linePos" in error &&
      Array.isArray(error.linePos) &&
      typeof error.linePos[0] === "object" &&
      error.linePos[0] !== null &&
      "line" in error.linePos[0]
        ? error.linePos[0].line
        : null;
    return {
      config: null,
      error: line ? `invalid YAML at line ${line}` : "invalid YAML",
    };
  }
  if (data === null || typeof data !== "object")
    return {
      config: null,
      error: "configuration must be an object",
    };
  const validator = Compile(configSchema);
  if (!validator.Check(data))
    return {
      config: null,
      error: "invalid configuration values",
    };
  const partial = data as Partial<MinifooterConfig>;
  const merged: MinifooterConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    ...partial,
    footer_layout:
      partial.footer_layout?.map((row) => ({
        items: row.items ?? [],
        separator: row.separator ?? "slash",
      })) ?? structuredClone(DEFAULT_CONFIG.footer_layout),
    border_slots: {
      ...DEFAULT_CONFIG.border_slots,
      ...partial.border_slots,
    },
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...partial.thresholds,
    },
  };
  const borderIds = Object.values(merged.border_slots).filter((id) => id !== "none");
  if (new Set(borderIds).size !== borderIds.length)
    return {
      config: null,
      error: "duplicate border slot parameter",
    };
  const t = merged.thresholds;
  if (!(t.context_warn < t.context_alert && t.context_alert < t.context_danger))
    return {
      config: null,
      error: "context thresholds must be ordered",
    };
  return {
    config: merged,
    error: null,
  };
}

export function parseConfig(raw: string): MinifooterConfig | null {
  return parseConfigWithError(raw).config;
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

/** 从磁盘加载配置。文件缺失返回默认值，其他失败由调用方保留上一份。 */
export interface ConfigLoadResult {
  error: string | null;
  loaded: LoadedConfig | null;
}

/** 从磁盘加载配置并保留可展示的解析错误。 */
export function loadConfigWithError(path: string): ConfigLoadResult {
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return {
      error: null,
      loaded: {
        config: structuredClone(DEFAULT_CONFIG),
        mtime: null,
      },
    };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {
      error: "unable to read minifooter.yml",
      loaded: null,
    };
  }
  const parsed = parseConfigWithError(raw);
  return parsed.config === null
    ? {
        error: parsed.error,
        loaded: null,
      }
    : {
        error: null,
        loaded: {
          config: parsed.config,
          mtime,
        },
      };
}

export function loadConfig(path: string): LoadedConfig | null {
  return loadConfigWithError(path).loaded;
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
