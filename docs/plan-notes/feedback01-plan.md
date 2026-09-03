# xpi-minifooter 功能增强与缺陷修复实施计划

## 概述
本计划旨在解决 `xpi-minifooter` 扩展在配置持久化、对话框布局、边框与页脚参数互斥性，以及面板配置编辑交互等方面的 4 项核心诉求：
1. **配置面板 Save 不生效 Bug 根因修复**：`src/index.ts` 中通过 `parseConfig(JSON.stringify(result.config))` 做校验时，`parseConfig` 对 `data` 使用了严格的 `configSchema` 校验并对空字段依赖默认值合并。面板直接返回的对象在特定缺省值或格式上有轻微不匹配时会导致 `parseConfig` 返回 `null` 进而被直接丢弃；另外打开面板时传递的未实时重载的内存副本可能覆盖外部修改，需修复从磁盘加载最新并确保 Save 反序列化与运行时立即同步。
2. **对话框边框内间距可选（默认 / 宽松）**：在配置 Schema 中增加 `editor_padding: "default" | "relaxed"`（默认 `"default"`），在 `BorderStatusEditor.render()` 中当设为 `"relaxed"` 时，在顶部边框线后以及底部边框线前插入空白行，实现无破坏性的内边距控制。
3. **边框与 Footer 参数去重与唯一性**：当参数被嵌入四个角（`top_left`, `top_right`, `bottom_left`, `bottom_right`）且非 `"none"` 时，在 footer 渲染管线 `buildFooterRows()` 中自动过滤已被边框使用的参数，且在前端面板选择边框槽位时联动动态隐藏/去重，保证 TUI 呈现全局唯一。
4. **配置面板增加顶部导航栏与 YAML 源码直编/参数手册**：面板增加顶部 Tab 切换（“表单配置” / “YAML源码”），在源码页中可直接编辑完整 `minifooter.yml` 文本；附带可折叠的参数字典（12 个参数 ID 解释、当前可选枚举与示例模板）；保存前统一经过 `parseConfig` 严格校验，错误时在界面精准提示行号，有效时直接落盘并生效。

---

## 变更范围与改动细节

### 1. 配置模型与校验扩展 (`src/config.ts`)
- **Schema 扩展**：
  在 `configSchema` 中增加：
  ```ts
  editor_padding: Type.Optional(Type.Union([
    Type.Literal("default"),
    Type.Literal("relaxed")
  ]))
  ```
- **接口与默认值定义**：
  `MinifooterConfig` 增加 `editor_padding: "default" | "relaxed"`；
  `DEFAULT_CONFIG` 增加 `editor_padding: "default"`。
- **配置合并**：
  `parseConfig` 合并逻辑同步支持 `editor_padding` 默认兜底。

### 2. 对话框边框内间距渲染 (`src/session.ts` & `src/editor-border.ts`)
- **边框编辑器行输出**：
  在 `BorderStatusEditor.render(width: number)` 中：
  - 调用 `super.render(width)` 拿到基础文本行。
  - 原实现只替换了首行与末行。
  - 当 `runtime.config.editor_padding === "relaxed"` 且编辑器行数 >= 2 时：
    - 首行是顶部状态栏，在索引 1 处插入一行 `""` 空行；
    - 末行是底部状态栏，在末行前插入一行 `""` 空行；
    - 这样在顶部横线与第一行输入文字之间、最后一行输入文字与底部横线之间均产生舒适的 1 行垂直留白。若为 `"default"` 则保持原生紧凑间距。

### 3. 参数唯一性过滤 (`src/session.ts`)
- **渲染端过滤**：
  在 `buildFooterRows(config, inputs, width, runPorcelain)` 中：
  - 提取边框所有已选的非 `"none"` 参数集合：
    ```ts
    const activeBorderSlots = new Set(
      Object.values(config.border_slots).filter((id) => id !== "none")
    );
    ```
  - 遍历 `config.footer_layout` 的 `row.items` 时，过滤掉已存在于 `activeBorderSlots` 中的参数：
    ```ts
    const availableItems = row.items.filter((id) => !activeBorderSlots.has(id));
    ```
  - 确保被边框四角选中的参数在 footer 栏自动让位隐藏，避免屏幕信息冗余。

### 4. 命令入口与持久化修复 (`src/index.ts`)
- **排查与修复命令响应流**：
  - 用户手动修改 `minifooter.yml` 后，在触发 `/xpi-minifooter` 前，先执行 `runtime.maybeReload()` 确保打开面板时拿到的是磁盘最新配置，而非内存陈旧副本。
  - Panel 返回结果支持两种保存形式：
    1. 表单保存：返回 `config` 对象，通过 `parseConfig(serializeConfig(result.config))` 进行规范化与验证；
    2. 源码直接保存：返回 `rawYaml` 字符串，调用 `parseConfig(result.rawYaml)` 进行安全校验与结构化解析。
  - 校验通过后调用 `saveConfig(configPath(), valid)` 并执行 `runtime.applyConfig(valid)`；
  - 若校验失败，给出明确通知（例如 `ctx.ui.notify`），避免静默失败导致用户以为已生效。

### 5. Glimpse 面板增强 (`src/panel.ts`)
- **顶部 Tab 导航栏**：
  - Tab 1: **可视化表单 (Form)**：包括已有的基础设置、阈值、边框四角选择，新增 `editor_padding`（default / relaxed）下拉项。
  - Tab 2: **YAML 源码编辑 (YAML Source)**：
    - 多行代码编辑器风格的 `<textarea>`，初始载入当前磁盘/生效配置的完整 YAML 文本。
    - 右侧或底部设计“参数速查手册 (Parameter Reference)”卡片，列出全部 12 个参数 ID 及其含义（如 `model_name`: 模型名称、`thinking_mode`: 思考档位、`context_bar`: 上下文进度条等）与合法枚举值（如 `density`: compact/comfortable/spacious, `editor_padding`: default/relaxed）。
    - 附带一键插入示例或模板按钮。
- **表单与边框选项联动**：
  - 边框下拉选择联动 footer 预览：当选择某个参数放入边框时，下方 footer 预览中的同名参数自动隐藏并高亮提示“已嵌入边框”。
- **前后端协议增强**：
  - 保存事件支持 `{ action: "save", config: collect() }` 与 `{ action: "save-yaml", raw: yamlText }`。

### 6. TUI 降级模态框同步 (`src/tui-modal.ts`)
- 在纯终端/远程无 Glimpse 模式下的文本提示中，同步展示 `editor_padding` 状态及边框参数占用提示。

---

## 测试与验证方案

1. **配置解析与序列化测试 (`test/config.test.ts`)**：
   - 验证 `editor_padding: "relaxed"` 能正确解析。
   - 验证缺少 `editor_padding` 时能平滑补齐为 `"default"`。
   - 验证非法 `editor_padding` 值时 fail-closed 返回 `null`。
2. **唯一性过滤测试 (`test/session-wiring.test.ts`)**：
   - 构造包含 `top_left: "git_branch"` 的配置，并在 `footer_layout` 中也指定 `git_branch`。
   - 验证 `buildFooterRows` 返回的 segments 中不包含 `git_branch`。
   - 验证边框槽位改为 `"none"` 时，`buildFooterRows` 恢复渲染 `git_branch`。
3. **内间距渲染测试 (`test/editor-border.test.ts` / `test/session-wiring.test.ts`)**：
   - 模拟调用 `BorderStatusEditor.render(width)`。
   - 对比 `"default"` 与 `"relaxed"` 时的返回行数及空白行位置。
4. **面板保存与 YAML 解析测试 (`test/panel.test.ts`)**：
   - 模拟面板返回表单数据及直接返回 YAML 源码数据，验证 `openGlimpsePanel` 和 `index.ts` handler 的全流程解析。
5. **项目全套质量门禁**：
   - 执行 `pnpm typecheck`（TypeScript strict 零错误）。
   - 执行 `pnpm -w run lint`（Biome 代码规范检测通过）。
   - 执行 `pnpm test`（全部单测 100% 通过）。
