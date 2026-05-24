export interface SlugifyUrlSegmentOptions {
  lower?: boolean
}

const transliterations: Record<string, string> = {
  '\u00C4': 'Ae',
  '\u00D6': 'Oe',
  '\u00DC': 'Ue',
  '\u1E9E': 'SS',
  '\u00E4': 'ae',
  '\u00F6': 'oe',
  '\u00FC': 'ue',
  '\u00DF': 'ss',
  '\u00C6': 'AE',
  '\u01FC': 'AE',
  '\u00E6': 'ae',
  '\u01FD': 'ae',
  '\u0152': 'OE',
  '\u0153': 'oe',
  '\u00D0': 'D',
  '\u00F0': 'd',
  '\u0110': 'D',
  '\u0111': 'd',
  '\u0126': 'H',
  '\u0127': 'h',
  '\u0131': 'i',
  '\u0138': 'k',
  '\u0141': 'L',
  '\u0142': 'l',
  '\u0149': 'n',
  '\u014A': 'N',
  '\u014B': 'n',
  '\u00D8': 'O',
  '\u00F8': 'o',
  '\u00DE': 'Th',
  '\u00FE': 'th',
  '\u0166': 'T',
  '\u0167': 't'
}

export function slugifyUrlSegment (value: string, options: SlugifyUrlSegmentOptions = {}): string {
  const lower = options.lower ?? true
  const source = lower ? value.toLowerCase() : value
  const normalized = Array.from(source, character => transliterations[character] ?? character).join('')

  return normalized
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/@/g, ' at ')
    .replace(/['\u2019`´]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(lower ? /[^a-z0-9]+/g : /[^a-z0-9]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}
