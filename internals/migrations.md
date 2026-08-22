# Active migrations

## Ginko Docs agent-site bootstrap

- **Why it exists:** `@lupinum/ginko-docs@0.3.0-rc.5` still emits the removed `agent.site.url` field and does not emit the required `whenToUse` guidance. The private Ginko Content documentation app translates that output while exercising the strict 1.0 runtime contract.
- **Introduced:** 2026-08-21 in PR #50.
- **What depends on it:** Only `docs/content.config.ts`; it is not part of the published `@lupinum/ginko-content` package.
- **Remove when:** A published Ginko Docs prerelease uses Ginko Content 1.0, emits `whenToUse`/`whenNotToUse`, and no longer emits `agent.site.url`; upgrade `docs/package.json`, delete the adapter, and delete this ledger entry in the same commit.
