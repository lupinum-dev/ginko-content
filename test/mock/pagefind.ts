import { vi } from 'vitest'

export const pagefindMocks = {
  addCustomRecord: vi.fn(),
  writeFiles: vi.fn()
}

export const createIndex = vi.fn(async () => ({
  index: {
    addCustomRecord: pagefindMocks.addCustomRecord,
    writeFiles: pagefindMocks.writeFiles
  }
}))
