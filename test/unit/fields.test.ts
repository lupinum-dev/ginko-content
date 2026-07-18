import { describe, expect, test } from 'vitest'
import { z } from 'zod'

import {
  fields,
  getContentFieldMetadata,
} from '../../packages/content/src/types/fields'
import { reference } from '../../packages/content/src/types/config'
import {
  collectTopLevelReferenceFields,
  collectTopLevelReferenceFieldsByTarget
} from '../../packages/content/src/core/references/schema'

describe('content schema fields', () => {
  test('marks scalar helpers optional until required is requested', () => {
    const title = fields.text().label('Title')
    const requiredTitle = title.required()

    expect(title.safeParse(undefined).success).toBe(true)
    expect(requiredTitle.safeParse(undefined).success).toBe(false)
    expect(getContentFieldMetadata(requiredTitle)).toMatchObject({
      type: 'text',
      label: 'Title',
      required: true,
    })
  })

  test('creates CMS image fields as asset references', () => {
    const avatar = fields.image({ aspectRatio: '1:1', accept: ['image/png'] }).required()

    expect(avatar.safeParse('asset:123').success).toBe(true)
    expect(avatar.safeParse({ src: '/avatar.png' }).success).toBe(false)
    expect(getContentFieldMetadata(avatar)).toMatchObject({
      type: 'image',
      required: true,
      localized: false,
      image: {
        aspectRatio: '1:1',
        accept: ['image/png'],
      },
    })
  })

  test('creates relation and richtext metadata for CMS inference', () => {
    expect(getContentFieldMetadata(fields.relation('authors').required())).toMatchObject({
      type: 'relation',
      required: true,
      localized: false,
      relation: { collectionId: 'authors', multiple: false },
    })
    expect(getContentFieldMetadata(fields.relations('authors'))).toMatchObject({
      type: 'relations',
      required: false,
      localized: false,
      relation: { collectionId: 'authors', multiple: true },
    })
    expect(getContentFieldMetadata(fields.richtext())).toMatchObject({
      type: 'richtext',
      required: false,
    })
  })

  test('fields.date() parses valid YYYY-MM-DD strings and preserves them verbatim', () => {
    const date = fields.date()

    expect(date.parse('2026-01-15')).toBe('2026-01-15')
    expect(typeof date.parse('2026-01-15')).toBe('string')
  })

  test('fields.date() rejects an invalid calendar date', () => {
    const date = fields.date()

    expect(date.safeParse('2026-02-31').success).toBe(false)
  })

  test('fields.date() rejects malformed date strings', () => {
    const date = fields.date()

    expect(date.safeParse('2026-1-5').success).toBe(false)
    expect(date.safeParse('not-a-date').success).toBe(false)
    expect(date.safeParse('2026-01-15T00:00:00Z').success).toBe(false)
  })

  test('fields.date() accepts a Date instance at the parse boundary and normalizes it to YYYY-MM-DD', () => {
    const date = fields.date()
    const result = date.parse(new Date(Date.UTC(2026, 0, 15)))

    expect(result).toBe('2026-01-15')
    expect(typeof result).toBe('string')
  })

  test('fields.datetime() normalizes offsets to a UTC ISO 8601 string', () => {
    const datetime = fields.datetime()

    expect(datetime.parse('2026-01-01T05:00:00+05:00')).toBe('2026-01-01T00:00:00.000Z')
  })

  test('fields.datetime() output is always a string, never a Date', () => {
    const datetime = fields.datetime()

    const fromString = datetime.parse('2026-01-01T00:00:00.000Z')
    const fromDate = datetime.parse(new Date('2026-01-01T00:00:00.000Z'))

    expect(typeof fromString).toBe('string')
    expect(typeof fromDate).toBe('string')
    expect(fromString).not.toBeInstanceOf(Date)
    expect(fromDate).not.toBeInstanceOf(Date)
  })

  test('fields.datetime() rejects values that cannot convert to a valid date/time', () => {
    const datetime = fields.datetime()

    expect(datetime.safeParse('not-a-datetime').success).toBe(false)
  })

  test('uses required item schemas inside array helpers', () => {
    const labels = fields.array(fields.text())
    const authors = fields.array(fields.relation('authors'))

    expect(labels.safeParse(['one', 'two']).success).toBe(true)
    expect(labels.safeParse(['one', undefined]).success).toBe(false)
    expect(authors.safeParse(['authors.alice']).success).toBe(true)
    expect(authors.safeParse(['authors.alice', undefined]).success).toBe(false)
    expect(getContentFieldMetadata(authors)).toMatchObject({
      type: 'relations',
      relation: { collectionId: 'authors', multiple: true },
    })
  })

  test('derives backlink relation metadata from top-level schema references', () => {
    const schema = z.object({
      authors: fields.relations('authors'),
      editor: fields.relation('authors'),
      related: z.array(reference('posts')),
      external: reference()
    })

    expect(collectTopLevelReferenceFieldsByTarget(schema)).toEqual({
      authors: ['authors', 'editor'],
      posts: ['related'],
      '*': ['external']
    })
    expect(collectTopLevelReferenceFields(schema, 'authors')).toEqual(['authors', 'editor', 'external'])
  })
})
