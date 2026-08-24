import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // TanStack Table and React Hook Form intentionally expose stable mutable APIs.
    // React Compiler skips those call sites; this app does not enable the compiler.
    rules: { "react-hooks/incompatible-library": "off" },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "node_modules/**",
    "next-env.d.ts",
    "public/**",
  ]),
]);
