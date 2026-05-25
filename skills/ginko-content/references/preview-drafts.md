# Preview, Drafts, and Partials

Use this when wiring editorial preview, hiding work in progress, or reusing partial content.

## Drafts

There are two draft conventions:

- `draft: true` in frontmatter.
- A `.draft` path segment, such as `content/docs/.draft/notes.md`.

Drafts are excluded from public production reads unless preview mode is active.

## Partials

Underscore files and folders are partials, not drafts:

```txt
content/
  docs/
    _shared-intro.md
    _snippets/
      warning.md
```

The generated path strips the underscore marker:

```txt
content/docs/_shared-intro.md -> /docs/shared-intro
```

Partials are parsed for internal composition, but production public queries exclude them. Do not build user-facing pages that depend on querying partials from public app code.

## Preview setup

Preview is disabled unless the Nuxt app sets `content.preview.token`:

```ts
export default defineNuxtConfig({
  content: {
    preview: {
      token: process.env.CONTENT_PREVIEW_TOKEN
    }
  }
})
```

For app pages and composables, use the preview helper. It stores the matching token in the `previewToken` cookie/session state and reloads the page so content requests include preview headers:

```ts
import { useContentPreview } from '@lupinum/ginko-content/client'

async function enterPreview(token: string) {
  useContentPreview().setPreviewToken(token)
}

async function exitPreview() {
  useContentPreview().setPreviewToken(undefined)
}
```

Ginko forwards the stored token as the `x-nuxt-content-preview` header on content API requests. Direct content API calls may send the matching `previewToken` query value or `x-nuxt-content-preview` header.

## Validation

```bash
pnpm exec ginko-content doctor
pnpm build
```

For preview-specific work, test one public page without preview and the same page with the preview token active.
