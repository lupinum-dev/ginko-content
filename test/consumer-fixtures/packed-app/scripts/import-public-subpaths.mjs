const subpaths = [
  "@lupinum/ginko-content/config",
  "@lupinum/ginko-content/navigation",
  "@lupinum/ginko-content/provider",
  "@lupinum/ginko-content/data-source",
  "@lupinum/ginko-content/portability",
  "@lupinum/ginko-content/portability/node",
  "@lupinum/ginko-content/transformers",
  "@lupinum/ginko-content/cms-contract",
  "@lupinum/ginko-content/cms-contract/node",
  "@lupinum/ginko-content/testing/provider-fixture",
  "@lupinum/ginko-content/testing/provider-contract",
  "@lupinum/ginko-content/testing/data-source-contract",
  "@lupinum/ginko-content/testing/portability-contract"
]

      for (const subpath of subpaths) {
        console.log(`Importing ${subpath}`)
        await import(subpath)
      }

      try {
        const supersededCmsImport = '@lupinum/ginko-content/' + 'cms-import'
        await import(supersededCmsImport)
        throw new Error('Superseded CMS import subpath unexpectedly resolved')
      } catch (error) {
        if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
      }

      const { mkdtemp, readFile, rm } = await import('node:fs/promises')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const { collectPortableMdcAssetReferences, parsePortableDocument, rewritePortableMdcAssetReferences } = await import('@lupinum/ginko-content/portability')
      const { readPortableDirectory, rebuildPortableDirectoryManifest, writePortableDirectory } = await import('@lupinum/ginko-content/portability/node')
      const { PORTABILITY_CONTRACT_FIXTURES, createPortabilityContractFixture, runPortabilityContract, runPortableDirectoryContract } = await import('@lupinum/ginko-content/testing/portability-contract')
      const parent = await mkdtemp(join(tmpdir(), 'ginko-packed-portability-'))
      try {
        const contract = createPortabilityContractFixture()
        const document = await parsePortableDocument(PORTABILITY_CONTRACT_FIXTURES.document, contract)
        const result = await runPortabilityContract()
        if (result.checks !== 9) throw new Error('Packed portability codec contract failed')
        const localPath = '/ginko-assets/' + PORTABILITY_CONTRACT_FIXTURES.png.sha256 + '.png'
        const codeDelimiter = String.fromCharCode(96)
        const body = '![Packed](' + localPath + ')\n\n' + codeDelimiter + localPath + codeDelimiter
        const references = await collectPortableMdcAssetReferences(body, contract.collections.docs.componentPolicy)
        const rewritten = await rewritePortableMdcAssetReferences(
          body,
          contract.collections.docs.componentPolicy,
          reference => 'https://assets.example.test/' + reference.sha256 + '.png'
        )
        if (references.length !== 1 || !rewritten.includes('https://assets.example.test/') || !rewritten.includes(codeDelimiter + localPath + codeDelimiter)) {
          throw new Error('Packed portability MDC asset contract failed')
        }
        const directory = await runPortableDirectoryContract({
          firstDestination: join(parent, 'first'),
          secondDestination: join(parent, 'second'),
          write: writePortableDirectory,
          read: readPortableDirectory,
          rebuildManifest: rebuildPortableDirectoryManifest,
          readManifestBytes: destination => readFile(join(destination, '.ginko/portable.json'))
        })
        if (directory.checks !== 3 || document.canonicalKey !== 'docs.introduction') throw new Error('Packed portability directory contract failed')
      } finally {
        await rm(parent, { recursive: true, force: true })
      }
    
