import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // references/ 是外部参考仓库, 不是本扩展代码, 排除出测试与覆盖率
    exclude: [
      "references/**",
      "node_modules/**",
    ],
  },
});
