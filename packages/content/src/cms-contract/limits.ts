/** Canonical resource limits shared by portable codecs and filesystem boundaries. */
export const PORTABLE_CONTENT_LIMITS = Object.freeze({
  documents: 100_000,
  files: 200_000,
  documentBytes: 2 * 1024 * 1024,
  assetBytes: 25 * 1024 * 1024,
  contractBytes: 4 * 1024 * 1024,
  manifestBytes: 32 * 1024 * 1024,
  totalBytes: 10 * 1024 * 1024 * 1024,
  imageDimension: 16_384,
  imagePixels: 100_000_000,
  imageFrames: 100,
  imageDecodedBytes: 512 * 1024 * 1024,
})
