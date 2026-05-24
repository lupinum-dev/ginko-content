declare module 'picomatch' {
  export interface PicomatchOptions {
    dot?: boolean
  }

  const picomatch: (glob: string, options?: PicomatchOptions) => (input: string) => boolean
  export default picomatch
}
