export const createStorage = <T = any>(initial: Record<string, T> = {}) => {
  const state = new Map<string, T>(Object.entries(initial))

  return {
    async getItem(key: string) {
      return state.get(key) ?? null
    },
    async setItem(key: string, value: T) {
      state.set(key, value)
    },
    async getKeys(prefix = '') {
      return Array.from(state.keys()).filter(key => key.startsWith(prefix))
    },
    async getMeta(key: string) {
      const value = state.get(key) as any
      return value?._meta || null
    },
    async hasItem(key: string) {
      return state.has(key)
    },
    _state: state
  }
}
