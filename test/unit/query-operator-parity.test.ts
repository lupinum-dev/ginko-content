import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { compileWhere } from '../../packages/content/src/core/query/filter'
import {
  PROVIDER_CAPABILITY_OPERATORS,
  PROVIDER_QUERY_OPERATORS,
  PUBLIC_QUERY_OPERATORS
} from '../../packages/content/src/core/query/operators'
import { filesystemProvider } from '../../packages/content/src/runtime/server/providers/filesystem'
import { validateContentQueryRequestBody } from '../../packages/content/src/runtime/server/query-http-validation'

const publicOperands: Record<(typeof PUBLIC_QUERY_OPERATORS)[number], unknown> = {
  $eq: 'published',
  $ne: 'draft',
  $gt: 1,
  $gte: 1,
  $lt: 10,
  $lte: 10,
  $in: ['published'],
  $nin: ['archived'],
  $contains: 'nuxt',
  $containsAny: ['nuxt'],
  $icontains: 'guide',
  $exists: true,
  $type: 'string',
  $prefix: '/docs'
}

describe('query operator boundaries', () => {
  test('defines one explicit public set and a provider superset', () => {
    expect(new Set(PUBLIC_QUERY_OPERATORS).size).toBe(PUBLIC_QUERY_OPERATORS.length)
    expect(new Set(PROVIDER_QUERY_OPERATORS).size).toBe(PROVIDER_QUERY_OPERATORS.length)
    expect(PROVIDER_QUERY_OPERATORS).toEqual(expect.arrayContaining(PUBLIC_QUERY_OPERATORS))
    expect(PUBLIC_QUERY_OPERATORS).toContain('$nin')
    expect(PUBLIC_QUERY_OPERATORS).not.toContain('$regex')
    expect(PUBLIC_QUERY_OPERATORS).not.toContain('$options')
    expect(PROVIDER_QUERY_OPERATORS).toContain('$regex')
  })

  test('compiles public $nin losslessly', () => {
    expect(compileWhere({ status: { $nin: ['draft', 'archived'] } })).toEqual({
      status: { $nin: ['draft', 'archived'] }
    })
  })

  test('keeps $not logical and rejects it as a field operator', () => {
    expect(compileWhere({ $not: { status: { $eq: 'draft' } } })).toEqual({
      $not: { status: { $eq: 'draft' } }
    })
    expect(validateContentQueryRequestBody({
      collection: 'docs',
      where: [{ $not: { status: { $eq: 'draft' } } }]
    })).toMatchObject({ ok: true })
    expect(validateContentQueryRequestBody({
      collection: 'docs',
      where: [{ status: { $not: { $eq: 'draft' } } }]
    })).toMatchObject({ ok: false })
  })

  test('HTTP validation accepts every public field operator and rejects provider-only regex syntax', () => {
    for (const operator of PUBLIC_QUERY_OPERATORS) {
      const result = validateContentQueryRequestBody({
        collection: 'docs',
        where: [{ title: { [operator]: publicOperands[operator] } }]
      })
      expect(result, operator).toMatchObject({ ok: true })
    }

    for (const where of [
      { title: { $regex: '^Guide' } },
      { title: { $regex: '^Guide', $options: 'i' } },
      { title: { $options: 'i' } }
    ]) {
      expect(validateContentQueryRequestBody({ collection: 'docs', where: [where] }).ok).toBe(false)
    }
  })

  test('filesystem capabilities advertise the provider set without the regex modifier', () => {
    expect(filesystemProvider.capabilities.query.operators).toEqual(PROVIDER_CAPABILITY_OPERATORS)
    expect(PROVIDER_CAPABILITY_OPERATORS).not.toContain('$not')
  })

  test('the public operator reference lists exactly the public field operators', () => {
    const source = readFileSync(
      resolve(__dirname, '../../docs/content/docs/5.reference/9.query-operators.md'),
      'utf8'
    )
    const rows = [...source.matchAll(/\|\s*`(\$\w+)`\s*\|/g)].map(match => match[1])

    expect(rows).toEqual([...PUBLIC_QUERY_OPERATORS])
  })
})
