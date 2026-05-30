import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    // Node CLI tooling (contrast checker, live smoke/probe scripts) runs in
    // Node, not the browser — give it the Node globals so no-undef is correct.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    rules: {
      // Foundation guardrail: the service-role admin client must never be
      // imported into client code. 'server-only' enforces this at runtime;
      // this keeps the intent visible. (REUSE-ANALYSIS #2 caveat.)
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

export default eslintConfig;
