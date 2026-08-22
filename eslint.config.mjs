import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate sub-projects with their own toolchains (mirror tsconfig excludes):
    "chrome-extension/**",
    "scraper/**",
    // Python backend — contains a .venv with Django's bundled JS files that
    // are not TypeScript and must not be linted by the Next.js ESLint config.
    "backend-python/**",
  ]),
  // Conventional "_" prefix marks intentionally-unused args/vars.
  // The Next.js preset's no-unused-vars rule doesn't allow this by default;
  // turning it on here keeps placeholder parameters (e.g. handlers that
  // need to match a shared signature but don't use ctx) from erroring.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
