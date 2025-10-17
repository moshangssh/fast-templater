
import globals from "globals";
import tseslint from "typescript-eslint";
import eslint from "@eslint/js";

export default tseslint.config(
  {
    ignores: [
      "main.js",
      "dist/",
      "node_modules/",
      "coverage/",
      "*.mjs" // Ignore .mjs files for now to solve the process issue
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { "argsIgnorePattern": "^_" }
      ],
      "no-undef": "warn" // Warn for undefined variables, as it can be noisy in test files
    },
  },
  {
    files: ["jest.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
        "no-undef": "off"
    }
  }
);
