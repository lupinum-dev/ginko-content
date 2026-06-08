import { resolve } from 'node:path'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

const alias = {
  'bun:test': resolve('./test/mock/bun-test-stub.ts'),
  '#build/content-i18n.mjs': resolve('./test/mock/content-i18n.ts'),
  '#content/virtual/config': resolve('./test/mock/content-config.ts'),
  '#content/virtual/providers': resolve('./test/mock/content-provider-registry.ts'),
  '@lupinum/ginko-content/transformers': resolve('./packages/content/src/runtime/transformers/define.ts'),
  'pagefind': resolve('./test/mock/pagefind.ts'),
  'magic-string': resolve('./node_modules/magic-string/dist/magic-string.cjs.js')
}

const commonExclude = [
  '**/.data/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**'
]

const productionFixtureTests = [
  'test/e2e/**/*.test.ts'
]

const nodeAlias = {
  ...alias,
  'nitropack/runtime': resolve('./test/mock/nitropack-runtime.ts')
}

const nodeContractTests = [
  'test/contracts/module-contracts.test.ts',
  'test/contracts/runtime-assets-contracts.test.ts',
  'test/contracts/server-handlers-contracts.test.ts',
  'test/contracts/transformers-contracts.test.ts',
  'test/contracts/vnext-golden-demo.test.ts'
]

export default defineConfig({
  resolve: {
    alias
  },
  test: {
    projects: [
      {
        resolve: { alias: nodeAlias },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'test/unit/**/*.test.ts',
            'test/ginko-query.test.ts',
            'test/ginko-transformer.test.ts',
            'test/ginko-unified-query.test.ts',
            'test/ginko-utils.test.ts'
          ],
          exclude: commonExclude
        }
      },
      {
        resolve: { alias: nodeAlias },
        test: {
          name: 'provider',
          environment: 'node',
          include: ['test/provider/**/*.test.ts'],
          exclude: commonExclude
        }
      },
      {
        resolve: {
          alias: {
            ...nodeAlias,
            '@nuxt/kit': resolve('./test/mock/nuxt-kit.ts')
          }
        },
        test: {
          name: 'contracts-node',
          environment: 'node',
          include: nodeContractTests,
          exclude: commonExclude
        }
      },
      {
        resolve: { alias: nodeAlias },
        test: {
          name: 'runtime',
          environment: 'node',
          include: ['test/runtime/**/*.test.ts'],
          exclude: commonExclude
        }
      },
      {
        resolve: {
          alias: {
            ...nodeAlias,
            '#imports': resolve('./test/mock/nuxt-imports.ts')
          }
        },
        test: {
          name: 'client',
          environment: 'node',
          include: [
            'test/client/**/*.test.ts',
            'test/ginko-unified-populate.test.ts'
          ],
          exclude: commonExclude
        }
      },
      await defineVitestProject({
        resolve: { alias },
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          include: ['test/contracts/**/*.test.ts'],
          exclude: [
            ...commonExclude,
            ...nodeContractTests,
            ...productionFixtureTests
          ]
        }
      }),
      {
        resolve: { alias },
        test: {
          name: 'e2e',
          environment: 'node',
          testTimeout: 300000,
          hookTimeout: 240000,
          fileParallelism: false,
          maxWorkers: 1,
          include: productionFixtureTests,
          exclude: commonExclude
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'browser-e2e',
          environment: 'node',
          testTimeout: 120000,
          hookTimeout: 240000,
          fileParallelism: false,
          maxWorkers: 1,
          include: ['test/browser-e2e/**/*.test.ts'],
          exclude: commonExclude
        }
      }
    ]
  }
})
