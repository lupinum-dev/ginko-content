// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    tooling: true,
  },
  dirs: {
    src: [
      './docs',
      './playground',
      './examples',
      './test/fixtures',
    ],
  },
}, {
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    'vue/multi-word-component-names': 'off',
    'regexp/no-super-linear-backtracking': 'off',
    'regexp/no-unused-capturing-group': 'off',
    'regexp/prefer-d': 'off',
    'regexp/prefer-w': 'off',
    'jsdoc/no-multi-asterisks': 'off',
    'unicorn/no-new-array': 'off',
    'unicorn/prefer-node-protocol': 'off',
    'unicorn/prefer-number-properties': 'off',
    'vue/no-multiple-template-root': 'off',
  },
  ignores: [
    'docs/.nuxt/**',
    'docs/.output/**',
    'playground/**/.nuxt/**',
    'playground/**/.output/**',
    'test/fixtures/**/.nuxt/**',
    'test/fixtures/**/.data/**',
  ],
}, {
  // Preserve the exact canonical Lupinum OSS dependency checker.
  ignores: ['scripts/check-dependency-policy.mjs'],
})
