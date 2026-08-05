/**
 * ESLint Configuration
 * @see https://eslint.org/docs/latest/use/configure/
 */

import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Apply to all JavaScript files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js globals
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        structuredClone: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',

        // k6 globals (for test files)
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
        open: 'readonly',
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...prettierConfig.rules,

      // Prettier integration
      'prettier/prettier': 'error',

      // Best practices
      'no-console': 'off', // We use console for logging in load tests
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'warn',
      'no-duplicate-imports': 'error',

      // ES6+
      'arrow-body-style': ['warn', 'as-needed'],
      'object-shorthand': ['warn', 'always'],
      'prefer-template': 'warn',
      'prefer-destructuring': ['warn', { object: true, array: false }],

      // Error prevention
      'no-await-in-loop': 'warn',
      'no-promise-executor-return': 'warn',
      'require-atomic-updates': 'warn',

      // Code quality
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'default-case': 'warn',
      'no-else-return': 'warn',
      'no-implicit-coercion': 'warn',
      'no-return-await': 'warn',
      'no-useless-return': 'warn',
      yoda: 'error',
    },
  },

  // Browser files (public folder)
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        navigator: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        location: 'readonly',
        history: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        FileReader: 'readonly',
        AbortController: 'readonly',

        // Libraries
        Vue: 'readonly',
        Chart: 'readonly',
        extractCurlData: 'readonly',
        API_BASE: 'readonly',
        apiFetch: 'readonly',
        PAUSED_RESUME_IDLE_MS: 'readonly',
        isTerminalPauseStopError: 'readonly',
        Icon: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'warn', // More lenient for UI code
    },
  },

  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'reports/**',
      'logs/**',
      'test-results/**',
      'coverage/**',
      '*.min.js',
      'public/assets/**',
      'public/dist/**',
      'public/index.bundled.html',
    ],
  },

  // Specific rules for test files
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        fetch: 'readonly',
      },
    },
    rules: {
      'no-unused-expressions': 'off', // Common in tests
    },
  },

  // Specific rules for k6 test scenarios
  {
    files: ['tests/scenarios/**/*.js'],
    languageOptions: {
      globals: {
        // Additional k6-specific globals
        check: 'readonly',
        group: 'readonly',
        sleep: 'readonly',
        fail: 'readonly',
      },
    },
    rules: {
      'no-console': 'off', // k6 tests need console output
    },
  },
];
