const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

      export default defineEventHandler(async (event) => {
        const missing = encode({ collection: 'pages', where: [{ path: '/missing' }], first: true })
        return await event.$fetch('/api/_content/query/packed/' + missing + '.json')
      })
    
