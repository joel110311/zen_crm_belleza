import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "src/app/t/**/*.{ts,tsx}",
      "src/app/api/t/**/*.{ts,tsx}",
      "src/components/tenant/**/*.{ts,tsx}",
      "src/lib/tenant-services/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db", "@/lib/system-settings", "@/app/actions/*"],
              message: "El runtime multitenant debe recibir TenantRuntimeContext y no depender de la DB o acciones legacy.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated clients and bundled agent examples are not maintained application source.
    "src/generated/**",
    ".agent/**",
  ]),
]);

export default eslintConfig;
