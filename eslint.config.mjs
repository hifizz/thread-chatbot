import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // vendored 组件（shadcn on @base-ui/react）：其类型随库版本漂移，用 @ts-nocheck 忽略
  // 类型检查，这里相应放开 ban-ts-comment，避免把「忽略类型」再报成 lint 错。
  {
    files: [
      "components/ui/**/*.{ts,tsx}",
      "components/assistant-ui/**/*.{ts,tsx}",
    ],
    rules: { "@typescript-eslint/ban-ts-comment": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
