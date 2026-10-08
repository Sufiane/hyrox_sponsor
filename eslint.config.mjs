import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const rules = {
  '@typescript-eslint/explicit-function-return-type': [
    'error',
    { allowTypedFunctionExpressions: true },
  ],
};

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules,
  },
  {
    files: ['shared/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './shared/tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules,
  },
  {
    files: ['web/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './web/tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules,
  },
];
