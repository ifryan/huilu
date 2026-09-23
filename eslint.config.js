// @ts-check
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.output/**', '**/.wxt/**', '**/node_modules/**', '**/*.gen.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // 分层规则：共享包不得直接调用浏览器插件 API，平台能力由 apps/extension/platform 注入
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'packages/* 不得直接使用 chrome.*，请通过平台接口注入。' },
        { name: 'browser', message: 'packages/* 不得直接使用 browser.*，请通过平台接口注入。' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['wxt', 'wxt/*', '#imports'], message: 'packages/* 不得依赖 WXT。' }],
        },
      ],
    },
  },
  prettier,
)
