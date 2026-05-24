import type { ParsedContent } from '../types/content'
import { defineTransformer } from './utils'
import { fromCSV, type CsvColumnNode, type CsvRootNode, type CsvRowNode } from './from-csv'

const cellValue = (column: CsvColumnNode) => column.children[0]?.value

function toJsonObject (tree: CsvRootNode) {
  const [header, ...rows] = tree.children
  const columns = (header?.children || []).map(column => cellValue(column))

  return rows.map((row: CsvRowNode) => {
    return row.children.reduce((record: Record<string, string | undefined>, column: CsvColumnNode, index: number) => {
      const key = columns[index]
      if (typeof key === 'string') {
        record[key] = cellValue(column)
      }
      return record
    }, {})
  })
}

function toJsonArray (tree: CsvRootNode) {
  return tree.children.map((row: CsvRowNode) => {
    return row.children.map((column: CsvColumnNode) => cellValue(column))
  })
}

export default defineTransformer({
  name: 'csv',
  extensions: ['.csv'],
  parse: async (_id, content, options = {}) => {
    const tree = fromCSV(content, {
      delimiter: ',',
      json: true,
      ...options
    })
    const result = options.json === false ? toJsonArray(tree) : toJsonObject(tree)

    return <ParsedContent> {
      _id,
      _type: 'csv',
      body: result
    }
  }
})
