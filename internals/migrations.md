# Active migrations

## Nuxt Windows cache-driver resolver

- **Why it exists:** Nuxt 4.5.2 emits the internal Nitro cache driver as a Windows `file:` URL. Rollup does not resolve that URL and would externalize the import, leaving generated production output broken.
- **Introduced:** 2026-09-06.
- **What depends on it:** Windows production builds of Nuxt applications using Ginko Content.
- **Removal condition:** Remove the resolver and its focused tests after the lowest supported Nuxt release includes an upstream fix and the complete hosted Windows consumer lane passes without it.
- **Tracking issue:** [nuxt/nuxt#36278](https://github.com/nuxt/nuxt/issues/36278).
