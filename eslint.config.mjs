import js from '@eslint/js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

// Modules talk only through src/common: no direct imports between features.
const featureBoundary = (forbidden) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: forbidden.map((folder) => ({
        group: [`**/${folder}/*`],
        message: `Do not import ${folder}/ from here; move shared code to src/common.`,
      })),
    },
  ],
});

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.local/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      eqeqeq: 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Inside try, `return await` is required: otherwise catch/finally miss the rejection.
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      // Blank lines separate logical steps: declarations, conditions, loops, return.
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: ['const', 'let'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
        { blankLine: 'always', prev: '*', next: ['if', 'for', 'while', 'try', 'return'] },
        { blankLine: 'always', prev: ['if', 'for', 'while', 'try'], next: '*' },
      ],
    },
  },
  // Application code logs through Nest Logger; CLI scripts and tests may print.
  { files: ['src/**/*.ts'], rules: { 'no-console': 'error' } },
  { files: ['src/bets/**/*.ts'], rules: featureBoundary(['leaderboard']) },
  { files: ['src/leaderboard/**/*.ts'], rules: featureBoundary(['bets']) },
  {
    files: ['src/common/**/*.ts', 'src/config/**/*.ts', 'src/db/**/*.ts', 'src/messaging/**/*.ts'],
    rules: featureBoundary(['bets', 'leaderboard']),
  },
  { files: ['**/*.mjs'], ...tseslint.configs.disableTypeChecked },
);
