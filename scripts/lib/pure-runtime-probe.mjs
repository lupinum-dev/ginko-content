const canonicalVectors = Object.freeze([
  Object.freeze({
    value: { b: 2, a: 1 },
    canonical: '{"a":1,"b":2}',
    sha256: '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
  }),
  Object.freeze({
    value: {
      numbers: [JSON.parse('333333333.33333329'), 1e30, 4.5, 2e-3, 1e-27, -0],
      nested: { b: null, a: true },
    },
    canonical:
      '{"nested":{"a":true,"b":null},"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0]}',
    sha256: 'd768b3ebcad1866c20c86d59dd7bcd35fad21683f84261eb2d0fd10926f219d0',
  }),
  Object.freeze({
    value: { unicode: 'café 東京 😀' },
    canonical: '{"unicode":"café 東京 😀"}',
    sha256: 'c3e2346f3671c7645bca80414b137d7bd72a5dd443e016d932cc30c882839709',
  }),
])

export async function runPureRuntimeProbe(api) {
  const decoder = new TextDecoder()
  const hashes = []
  for (const vector of canonicalVectors) {
    const bytes = api.canonicalJsonBytes(vector.value)
    assert(decoder.decode(bytes) === vector.canonical, 'canonical JSON vector changed')
    assert((await api.hashCanonicalJson(vector.value)) === vector.sha256, 'canonical hash changed')

    const incremental = new api.IncrementalSha256()
    for (let offset = 0; offset < bytes.length; offset += 3) {
      incremental.update(bytes.slice(offset, offset + 3))
    }
    assert(incremental.digestHex() === vector.sha256, 'incremental canonical hash changed')
    hashes.push(vector.sha256)
  }

  const contract = api.createPortabilityContractFixture()
  const document = await api.parsePortableDocument(api.PORTABILITY_CONTRACT_FIXTURES.document, contract)
  const reparsed = await api.parsePortableDocument(
    await api.serializePortableDocument(document, contract),
    contract,
  )
  assert(
    api.portableModelsSemanticallyEqual(
      { documents: [document], assets: [] },
      { documents: [reparsed], assets: [] },
    ),
    'portable codec semantic round trip changed',
  )
  assert(api.CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize === 100, 'data-source entry is invalid')

  return {
    vectorCount: canonicalVectors.length,
    hashes,
    canonicalKey: reparsed.canonicalKey,
    maxQueryPageSize: api.CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize,
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Pure runtime probe failed: ${message}.`)
}
