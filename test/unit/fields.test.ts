import { describe, expect, test } from 'vitest'

import {
  fields,
  getContentFieldMetadata,
  image,
  relation,
  richtext,
} from '../../packages/content/src/types/fields'

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
    const avatar = image({ aspectRatio: '1:1', accept: ['image/png'] }).required()

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
    expect(getContentFieldMetadata(relation('authors').required())).toMatchObject({
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
    expect(getContentFieldMetadata(richtext())).toMatchObject({
      type: 'richtext',
      required: false,
    })
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
})
