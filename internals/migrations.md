# Active migrations

## CMS CSS custom-property MDC attributes

- **Why it exists:** Ginko CMS stores inline colon MDC such as `:badge{ --variant="info" }`. Comark 0.6 no longer recognizes that CSS-custom-property spelling, so the shared Content profile contains one narrow compatibility token rule to prevent existing editor content from losing the property.
- **Introduced:** 2026-09-12.
- **What depends on it:** Existing Ginko CMS rich-text source and the `components-and-lists.mdc` editor conversion fixture.
- **Removal condition:** Remove the rule and this entry together after an audited one-time CMS source migration rewrites every stored CSS-custom-property MDC attribute to an accepted canonical property name and the legacy fixture is replaced with migrated source.
- **Tracking issue:** None yet; removal belongs to the future CMS source-migration work identified by the Ginko Editor rollout plan.

## Nuxt Windows cache-driver resolver

- **Why it exists:** Nuxt 4.5.2 emits the internal Nitro cache driver as a Windows `file:` URL. Rollup does not resolve that URL and would externalize the import, leaving generated production output broken.
- **Introduced:** 2026-09-06.
- **What depends on it:** Windows production builds of Nuxt applications using Ginko Content.
- **Removal condition:** Remove the resolver and its focused tests after the lowest supported Nuxt release includes an upstream fix and the complete hosted Windows consumer lane passes without it.
- **Tracking issue:** [nuxt/nuxt#36278](https://github.com/nuxt/nuxt/issues/36278).
