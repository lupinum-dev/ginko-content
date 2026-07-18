import { describe, expect, test } from 'vitest'
import { fixtureBuildKey } from '../helpers/production-fixture'

describe('production fixture cache key', () => {
  test('build and generate keys differ for identical rootDir + env', () => {
    const buildKey = fixtureBuildKey('/fixtures/ginko-i18n', { FOO: 'bar' }, 'build')
    const generateKey = fixtureBuildKey('/fixtures/ginko-i18n', { FOO: 'bar' }, 'generate')

    expect(buildKey).not.toBe(generateKey)
    expect(generateKey).toContain('::generate::')
  })

  test('mode defaults to build when omitted', () => {
    const explicitBuildKey = fixtureBuildKey('/fixtures/ginko-i18n', { FOO: 'bar' }, 'build')
    const defaultKey = fixtureBuildKey('/fixtures/ginko-i18n', { FOO: 'bar' })

    expect(defaultKey).toBe(explicitBuildKey)
  })

  test('generate key changes when env changes, same as build key', () => {
    const generateKeyA = fixtureBuildKey('/fixtures/ginko-i18n', { FOO: 'bar' }, 'generate')
    const generateKeyB = fixtureBuildKey('/fixtures/ginko-i18n', { FOO: 'baz' }, 'generate')

    expect(generateKeyA).not.toBe(generateKeyB)
  })

  test('build key for one fixture never collides with generate key for a different fixture', () => {
    const basicGenerateKey = fixtureBuildKey('/fixtures/ginko-basic', {}, 'generate')
    const i18nBuildKey = fixtureBuildKey('/fixtures/ginko-i18n', {}, 'build')

    expect(basicGenerateKey).not.toBe(i18nBuildKey)
  })

  test('env key ordering is normalized so key does not depend on property insertion order', () => {
    const keyA = fixtureBuildKey('/fixtures/ginko-i18n', { A: '1', B: '2' }, 'generate')
    const keyB = fixtureBuildKey('/fixtures/ginko-i18n', { B: '2', A: '1' }, 'generate')

    expect(keyA).toBe(keyB)
  })
})
