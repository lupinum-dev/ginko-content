# Content locale links

Status: implemented for the next prerelease. Updated 2026-09-08.

## Decision

`useContentLocalePath(pageResult, { fallback })` derives interactive locale
links from an explicitly supplied `useContentPage()` result. It makes no
request and owns no global page state. The source accepts a result, ref, or
getter; undefined identifies an application-only page.

The earlier `active: true` proposal is superseded. A header renders before an
async child page during SSR. Publishing child state cannot repair already
rendered parent HTML. Ginko's existing playground documented that constraint.
A global registry would add lifecycle complexity without satisfying SSR.

Load the page first, then render a page-owned NuxtLayout with the result as a
prop. The multilingual playground now demonstrates this with one shared header
for content and application-only pages. Its original HTML contains the correct
translated-slug links. Persistent outer headers instead need ancestor-owned
loading; do not use a late child publisher as a workaround.

## Contract and boundaries

- Keep existing page/query/provider APIs unchanged; no active option.
- Use only existing document alternates; prefer real variants.
- Return undefined for pending, missing, failed, stale, or untranslated content.
- Invoke application fallback only when no content-page result was supplied.
- Preserve query/hash for content navigation; callback results pass through.
- Keep SEO projection and application-specific anchor translation separate.
- No additional cache, endpoint, registry, or required-page helper.

Public examples and exact types are documented in the composables reference.
ADR 0016 records this narrow extension of the existing page workflow.

## Consumer migration

For lupinum-v6 and ginko-docs, load content in the route component, set
`layout: false` and a route-path page key, then render NuxtLayout with the page
result. Pass that result to the shared header and call useContentLocalePath.
Application-only pages use the same layout with no content result and a normal
Nuxt i18n fallback. Keep the localized contact-anchor override in the application.
Delete the old route-fact publishers and shared writable state once all their
consumers are migrated. Do not feed interactive links into SEO alternates.

A page-owned layout remounts on path changes. Move controls that require a
persistent lifetime above it or load content in a common ancestor. This is an
explicit layout choice, not hidden automatic synchronization.

## Verification and release

Focused tests cover alternate selection, missing/error/pending state, stale
results, reactive sources, independent owners, and application fallback.
The production browser fixture checks original SSR header HTML, translated
slug navigation, query/hash preservation, content-to-application switching,
back/forward navigation, and hydration of emitted routes. Existing page and
export contracts remain enforced. The full repository gate and protected CI
certification govern release readiness; this document is not certification.

Release preparation is additive. Consumer migration is separate; no content
migration or permanent shim is needed. Roll back a consumer migration and its
package pin together if necessary.
