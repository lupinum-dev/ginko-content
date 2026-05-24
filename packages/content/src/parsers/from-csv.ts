export interface CsvTextNode {
  type: 'text'
  value: string
}

export interface CsvColumnNode {
  type: 'column'
  children: CsvTextNode[]
}

export interface CsvRowNode {
  type: 'row'
  children: CsvColumnNode[]
}

export interface CsvRootNode {
  type: 'root'
  children: CsvRowNode[]
}

export interface CsvParseOptions {
  delimiter?: string
}

const createColumn = (value: string): CsvColumnNode => ({
  type: 'column',
  children: value ? [{ type: 'text', value }] : []
})

const createRow = (values: string[]): CsvRowNode => ({
  type: 'row',
  children: values.map(createColumn)
})

const normalizeDelimiter = (options?: CsvParseOptions) => {
  const delimiter = options?.delimiter || ','

  if (delimiter.length !== 1) {
    throw new Error('CSV delimiter must be a single character')
  }

  return delimiter
}

export const fromCSV = (
  value: string,
  encodingOrOptions?: string | CsvParseOptions,
  maybeOptions?: CsvParseOptions
): CsvRootNode => {
  const options = typeof encodingOrOptions === 'string' ? maybeOptions : encodingOrOptions
  const delimiter = normalizeDelimiter(options)
  const rows: CsvRowNode[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  const pushField = () => {
    row.push(field)
    field = ''
  }

  const pushRow = () => {
    pushField()
    rows.push(createRow(row))
    row = []
  }

  while (index < value.length) {
    const char = value[index]!

    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }

        quoted = false
        index += 1
        continue
      }

      field += char
      index += 1
      continue
    }

    if (char === '"') {
      if (field.length > 0) {
        throw new Error('Unexpected quote in unquoted CSV field')
      }

      quoted = true
      index += 1
      continue
    }

    if (char === delimiter) {
      pushField()
      index += 1
      continue
    }

    if (char === '\n' || char === '\r') {
      pushRow()
      if (char === '\r' && value[index + 1] === '\n') {
        index += 2
      } else {
        index += 1
      }
      continue
    }

    field += char
    index += 1
  }

  if (quoted) {
    throw new Error('Cannot close document, a token (`quotedData`) is still open')
  }

  if (field.length || row.length || !value.endsWith('\n') && !value.endsWith('\r')) {
    pushRow()
  }

  return {
    type: 'root',
    children: rows
  }
}
