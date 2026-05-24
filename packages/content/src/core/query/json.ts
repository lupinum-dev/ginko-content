export function jsonStringify(value: unknown) {
  return JSON.stringify(value, regExpReplacer)
}

export function jsonParse(value: string) {
  return JSON.parse(value, regExpReviver)
}

function regExpReplacer(_key: string, value: unknown) {
  if (value instanceof RegExp) {
    return `--REGEX ${value.toString()}`
  }

  return value
}

function regExpReviver(_key: string, value: unknown) {
  const withOperator = (typeof value === 'string' && value.match(/^--([A-Z]+) (.+)$/)) || []

  if (withOperator[1] === 'REGEX') {
    const regex = withOperator[2]?.match(/\/(.*)\/([dgimsuy]*)$/)
    return regex?.[1] ? new RegExp(regex[1], regex[2] || '') : value
  }

  return value
}
