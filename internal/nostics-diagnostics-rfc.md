# RFC: Scoped `nostics` Diagnostics for Ginko Content

> **Status:** Proposed.
> **Owner:** Ginko Content maintainers.
> **Last revised:** 2026-07-15.
> **Scope:** User-actionable Nuxt module setup and selected build failures in
> `@lupinum/ginko-content`. Runtime domain errors, provider errors, HTTP
> responses, portability errors, and doctor findings remain out of scope.

---

## 0. Decision

Ginko Content should adopt [`nostics`](https://github.com/vercel-labs/nostics)
for a small catalog of user-actionable configuration and build diagnostics.

The first implementation must be a narrow hard cutover of approximately 8–12
existing anonymous setup/build errors. It must not become a repository-wide
error framework.

The implementation will:

1. Add `nostics` as a runtime dependency of `@lupinum/ginko-content`.
2. Define one module-owned catalog in `packages/content/src/module/diagnostics.ts`.
3. Convert only selected Nuxt setup and build failures to stable diagnostic
   codes.
4. Throw diagnostics without configuring a global reporter.
5. Publish one stable documentation page for every diagnostic code.
6. Add an invariant check that prevents catalog codes and documentation pages
   from drifting apart.

The implementation will not:

- migrate `ContentError`;
- migrate provider or H3 errors;
- migrate `GinkoBoundaryError`;
- migrate CMS contract or wire validation errors;
- replace CLI doctor findings;
- export the catalog or `nostics` as public Ginko APIs;
- add `@nostics/unplugin`;
- use `defineProdDiagnostics`;
- add browser collection, file reporting, fetch reporting, or telemetry;
- introduce compatibility wrappers or parallel old/new diagnostic paths.

This decision is conditional on maintaining the documentation registry. If the
initial implementation does not include stable documentation pages and a drift
check, Ginko should not add the dependency.

---

## 1. Context

Ginko Content has several kinds of failure, and they do not all need the same
representation.

The repository already has strong structured error contracts:

- `ContentError` carries a stable pipeline code, context, and cause.
- Provider errors carry stable codes, HTTP status mapping, and structured data.
- `GinkoBoundaryError` carries a portability/directory boundary, operation,
  code, details, and source location.
- H3 errors represent HTTP response contracts.
- CLI doctor findings carry severity, file, message, suggestion, and aggregate
  exit status.

Those models solve domain and transport problems that `nostics` does not solve.
Replacing them would either lose information or require adapters and duplicate
sources of truth.

At the same time, the Nuxt module setup path contains user-facing failures that
are currently anonymous `Error` instances. Examples include:

- a missing or empty `content.config.ts`;
- an unavailable configured provider;
- options left in `nuxt.config.ts` after their ownership moved;
- removed Markdown options;
- an invalid or renamed search engine;
- a missing optional Pagefind dependency;
- invalid content page route metadata;
- invalid agent configuration.

These failures happen while users install, configure, upgrade, or build Ginko.
They benefit from a stable searchable identity, an explicit next action, and a
documentation URL that remains useful after the emitted message changes.

### 1.1 Current error inventory

A static inventory on 2026-07-15 found approximately:

| Surface | Occurrences |
|---|---:|
| Anonymous `Error`, `TypeError`, or `RangeError` construction | 188 |
| Warning/error logging calls | 31 |
| H3 `createError` calls | 25 |
| Provider-error factory calls | 28 |

The anonymous-error count is not a migration target. Most occurrences are
programmer errors, protocol validation, internal invariants, or test contract
failures. The useful adoption surface is the much smaller set of errors at the
module configuration and build boundary.

### 1.2 Existing structured contracts

The following remain authoritative:

- `packages/content/src/core/errors.ts`
- `packages/content/src/core/provider-errors.ts`
- `packages/content/src/public/provider-errors.ts`
- `packages/content/src/portability/errors.ts`
- `packages/content/src/cli/doctor/types.ts`

Their existing codes are public or domain-significant. A nostics code must not
wrap, shadow, or duplicate one of these codes.

### 1.3 Package assessment

The evaluation used `nostics@1.1.4`, current on 2026-07-15.

Relevant characteristics:

- ESM-only, matching Ginko's package format.
- Runtime-neutral core.
- No runtime dependencies.
- MIT licensed.
- npm provenance is present.
- Approximately 91.6 kB unpacked for the published package.
- A locally bundled one-code catalog measured approximately 907 bytes minified
  and 541 bytes gzipped.

The package is technically compatible and inexpensive in bundle terms. It is
also young: the repository was created in April 2026 and reached 1.0 in June
2026. That maturity profile supports a narrow integration rather than making
it foundational to every Ginko boundary.

---

## 2. Goals

The proposal has five goals.

### 2.1 Give user-actionable failures stable identities

A user should be able to search for `GINKO_C001` and reach the same problem
definition even if the prose improves in a later patch release.

### 2.2 Put the next action beside the failure

Every initial diagnostic must have a specific `fix`. A fix must name the
configuration, dependency, or source edit needed to proceed. It must not merely
say "fix the configuration" or repeat the failure.

### 2.3 Preserve full build diagnostics

Development and production builds must emit the same useful explanation and
fix. Production builds are not a reason to remove build-time diagnostic text.

### 2.4 Centralize message construction without moving domain logic

The catalog owns code, explanation, fix, and documentation URL construction.
Call sites continue to own detection, control flow, and source facts.

### 2.5 Improve tests without coupling them only to prose

Tests should assert the stable diagnostic code and the important parameters.
They may still assert critical message fragments, but code identity becomes the
primary contract.

---

## 3. Non-goals

This RFC does not attempt to:

- normalize every thrown exception in the repository;
- define a universal Ginko error base class;
- change HTTP status codes or response envelopes;
- change provider capability semantics;
- change portability error codes or locations;
- add production telemetry;
- collect browser diagnostics in development;
- strip warnings from application bundles;
- generate all error documentation from TypeScript;
- make internal invariant failures into supported public codes;
- expose diagnostic handles for consumers to call;
- promise that every `Error` thrown by Ginko has a diagnostic code.

---

## 4. Boundary classification

The deciding question is not whether a failure is technically an error. It is
whether a Ginko user can act on it and whether its identity should remain stable
across releases.

| Boundary | Use nostics? | Reason |
|---|---|---|
| Nuxt module configuration | Yes | Directly user-authored and frequently encountered during setup or upgrades. |
| Selected build validation | Yes | User-actionable and otherwise difficult to search or document. |
| Build infrastructure failure | Usually no | Often an internal defect or upstream failure without a stable user fix. |
| Content pipeline | No | `ContentError` already owns the typed domain contract. |
| Provider boundary | No | Existing errors include HTTP and provider-specific structured data. |
| Runtime HTTP API | No | H3 response semantics are authoritative. |
| Portability/directory boundary | No | `GinkoBoundaryError` already has richer structured context. |
| CMS contract/wire validation | No | These are protocol invariants and deliberate `TypeError` contracts. |
| CLI doctor | No | Doctor findings are aggregated results, not thrown errors. |
| Browser warning | Not initially | Nuxt/application logging ownership and duplication require separate evidence. |
| Internal invariant | No | Publishing a code would freeze an implementation detail. |

When classification is ambiguous, keep the existing error until a concrete
user-facing documentation page and fix can be written.

---

## 5. Proposed diagnostic catalog

### 5.1 Code format

Codes use:

```txt
GINKO_<CATEGORY><NUMBER>
```

Initial categories:

- `C`: configuration or dependency setup;
- `D`: removed or renamed behavior requiring an upgrade action;
- `B`: build-time validation of user-owned project state.

Numbers are three digits and monotonically allocated within a category. Once a
code ships, it must not be renamed, reassigned, or reused for another problem.

Codes identify problems, not files or call sites. Two call sites that detect the
same problem should use one code. Two distinct fixes should normally use two
codes even when detection happens in the same function.

### 5.2 Initial candidates

The exact list should be confirmed during implementation, but the first slice
should remain close to the following:

| Candidate | Problem identity | Current area |
|---|---|---|
| `GINKO_C001` | Missing or empty content configuration | `src/module.ts` |
| `GINKO_C002` | Configured provider is unavailable | `src/module/validation.ts` |
| `GINKO_C003` | Unsupported search engine | `src/module/options.ts` |
| `GINKO_C004` | Required optional dependency is missing | `src/module/options.ts`, `src/module/validation.ts` |
| `GINKO_D001` | Content-owned option remains in `nuxt.config.ts` | `src/module/validation.ts` |
| `GINKO_D002` | Search engine `cms` was renamed to `provider` | `src/module/options.ts` |
| `GINKO_D003` | Removed Markdown option is still configured | `src/module/validation.ts` |
| `GINKO_B001` | Page content metadata names no valid collection | `src/module/route-meta-validation.ts` |
| `GINKO_B002` | Page content metadata omits or conflicts with route metadata | `src/module/route-meta-validation.ts` |
| `GINKO_B003` | Agent configuration is invalid | `src/module/agent-config.ts` |

The implementation must not force all route-metadata failures into one code if
their fixes differ materially. The table describes an upper-level grouping,
not permission to erase useful distinctions.

Build failures such as port allocation, child-process exit, timeout, malformed
persisted internal state, or an unexpected internal cache response remain plain
errors unless maintainers can state a reliable user action. A stable code with
an invented fix is worse than an honest internal error.

---

## 6. Catalog architecture

### 6.1 One module-owned catalog

The initial catalog lives at:

```txt
packages/content/src/module/diagnostics.ts
```

It is not placed in `core`, `public`, `runtime`, `cms-contract`, or
`portability`. This prevents a build/config presentation concern from becoming
a dependency of runtime-neutral domain code.

The file directly exports the `defineDiagnostics()` result. It does not add a
factory, service, class hierarchy, generic adapter, or deep barrel export.

Illustrative shape:

```ts
import { defineDiagnostics } from 'nostics'

export const moduleDiagnostics = defineDiagnostics({
  docsBase: code =>
    `https://ginko-content.nuxt.dev/docs/errors/${code.toLowerCase()}`,
  codes: {
    GINKO_C001: {
      why: 'Ginko Content requires content.config.ts with at least one collection.',
      fix: 'Create content.config.ts and define at least one collection with defineContentConfig().'
    },
    GINKO_C002: {
      why: (params: { provider: string }) =>
        `Content provider "${params.provider}" is configured but was not registered.`,
      fix: (params: { provider: string }) =>
        `Register the module that provides "${params.provider}", or select an available provider.`
    }
  }
})
```

The final wording and URL shape must match the docs site's established routes.

### 6.2 Throwing errors

Thrown diagnostics use the direct form:

```ts
throw moduleDiagnostics.GINKO_C002({ provider })
```

The catalog has no reporters. Throwing remains the only presentation path for
these errors.

This avoids duplicate output. A reporter runs when a diagnostic is created;
throwing the returned error can then cause the runtime or build tool to render
the same failure again.

### 6.3 Warnings

Warnings remain on the existing Nuxt/consola logger path in the initial slice.

The implementation must not add a global console reporter for warnings. It
would bypass Nuxt's logger presentation and could duplicate output. A later RFC
or amendment may consider warnings if concrete examples prove that stable codes
and docs links outweigh the additional reporting integration.

### 6.4 Causes and sources

Use `cause` when a diagnostic explains a user-actionable failure that originated
from another exception, such as a dependency resolution failure.

Use `sources` only when the library can provide a real user-owned file location.
Do not put internal Ginko source files or speculative paths into `sources`.

If line and column are not known, pass only the file path. Do not invent
coordinates.

### 6.5 Public API boundary

The catalog is package-internal:

- no new package export;
- no re-export from the root module;
- no public `GinkoDiagnostic` wrapper;
- no public alias for `Diagnostic`;
- no requirement that consumers depend directly on `nostics`.

The stable code and documentation URL are user-visible behavior. The catalog
object and dependency types are not supported extension points.

---

## 7. Production behavior

### 7.1 Keep full text in production builds

Ginko must use `defineDiagnostics`, not `defineProdDiagnostics`, for this
catalog.

The selected diagnostics run during Nuxt configuration and build. A production
build is one of the main environments where a user needs the complete reason
and fix. Replacing the message with only `GINKO_C001` would reduce build
quality to save an immaterial amount of package text.

### 7.2 Do not add the strip plugin

The proposal does not add `@nostics/unplugin`.

The strip transform targets report-only calls that may disappear from
production bundles. The initial Ginko diagnostics are thrown errors and are
therefore control-flow behavior that cannot be stripped.

Ginko also builds a mixture of bundled entries and `mkdist` entries. Adding a
build transform across this topology solely for a small catalog would increase
build complexity without serving an acceptance criterion.

### 7.3 Preserve pure subpaths

No file in these areas may import the module diagnostic catalog or `nostics`:

- `src/cms-contract/`;
- `src/portability/`;
- `src/portability-node/`;
- provider/query domain code that is shared with runtime-neutral consumers.

Packed pure-runtime checks must prove this boundary remains intact.

---

## 8. Documentation registry

### 8.1 One stable page per code

Each code ships with one page under a stable error route. The final route shape
should be chosen once and then treated as durable public behavior.

Every page contains:

1. Code and short title.
2. What happened.
3. How to fix it.
4. Common causes, when useful.
5. A minimal configuration or source example.
6. Example output.
7. Version or migration notes when the diagnostic is a deprecation/removal.

The fix stays near the top. Users arriving from a failed build should not need
to read an architecture explanation before seeing the required action.

### 8.2 Source-of-truth rule

The TypeScript catalog is the source of truth for:

- code identity;
- short explanation;
- concise fix;
- documentation URL mapping.

The Markdown page owns extended explanation and examples. It must not define a
second machine-readable list of codes.

### 8.3 Drift check

Add one focused repository check that reads the catalog's declared codes and
verifies that each expected Markdown page exists. It should also detect a page
whose code no longer exists.

The check must be wired into the existing docs drift or repository policy gate
rather than creating a parallel general-purpose validation framework.

A diagnostic code and its page ship in the same change.

---

## 9. Testing strategy

### 9.1 Unit and contract tests

Converted tests assert:

- the thrown value is an `Error`;
- `error.name` is the expected stable code;
- the message contains the relevant dynamic facts;
- `fix` contains a concrete action;
- `docs` resolves to the expected stable page;
- `cause` is preserved where applicable.

Tests should not use `instanceof Diagnostic` as the only assertion. The stable
Ginko behavior is the code and output, not the consumer's ability to import and
compare nostics constructors.

### 9.2 Output tests

At least one module fixture must prove that a diagnostic emitted through a real
Nuxt setup/build path:

- contains code, explanation, fix, and docs URL;
- appears exactly once;
- retains full text when `NODE_ENV=production`.

### 9.3 Package tests

The package/export and packed-consumer lanes must prove:

- `nostics` is declared in published package metadata;
- a fresh consumer resolves it without workspace leakage;
- module setup can load the catalog from the packed tarball;
- no unsupported package export is added;
- pure-runtime imports do not load `nostics`.

### 9.4 Documentation tests

The docs gate must prove:

- every catalog code has a page;
- there are no orphan code pages;
- every page builds successfully;
- each page includes the code in its title or initial rendered content.

---

## 10. Rollout

### Phase 1: Catalog and smallest valuable slice

1. Add `nostics` to `packages/content/package.json`.
2. Add the single module catalog.
3. Convert four high-frequency setup failures:
   - missing content config;
   - unavailable provider;
   - unsupported search engine;
   - missing optional dependency.
4. Add four documentation pages.
5. Add the drift invariant.
6. Update focused tests and run the packed-consumer boundary.

This phase is the go/no-go checkpoint. If output is duplicated, production
messages are reduced, pure paths import nostics, or the docs registry feels
disproportionate, revert the experiment rather than adding adapters.

### Phase 2: Upgrade and route metadata diagnostics

After Phase 1 passes:

1. Convert removed/renamed configuration failures.
2. Convert the most actionable route metadata failures.
3. Convert agent configuration only where each problem has a stable fix.
4. Add corresponding pages and tests in the same changes.

### Phase 3: Stop

There is no automatic repository-wide migration phase.

After the initial catalog is established, new codes require the same boundary
classification as existing errors. The existence of nostics is not evidence
that a new failure needs a public diagnostic code.

---

## 11. Acceptance criteria

The RFC is implemented only when all of the following are true:

1. The initial catalog contains only user-actionable module setup/build
   failures.
2. Every code has a specific fix and stable documentation page.
3. Every selected error uses the new path exclusively; no parallel anonymous
   error or compatibility wrapper remains.
4. Full explanation and fix appear in both development and production builds.
5. A thrown diagnostic is rendered exactly once.
6. Existing `ContentError`, provider, H3, portability, CMS contract, and doctor
   contracts are unchanged.
7. No new public package export is introduced.
8. `nostics` does not enter pure CMS contract or portability dependency paths.
9. Code/page drift fails CI.
10. Focused tests, package contracts, type checks, docs checks, and packed
    consumer verification pass.
11. `pnpm verify` passes once before handoff.

---

## 12. Risks and mitigations

### 12.1 A second error system spreads across the repository

**Risk:** Contributors migrate domain or transport errors because the new
catalog exists.

**Mitigation:** Keep the catalog inside `src/module`, document the boundary
table, and reject codes without a stable user fix and docs page.

### 12.2 Duplicate logging

**Risk:** A reporter logs a diagnostic and the thrown error is logged again.

**Mitigation:** Configure no reporters for the thrown catalog. Throw the
diagnostic directly.

### 12.3 Production builds lose useful messages

**Risk:** `defineProdDiagnostics` or the strip plugin reduces build failures to
codes.

**Mitigation:** Use `defineDiagnostics` in every environment and do not install
the strip plugin.

### 12.4 Codes become permanent maintenance obligations

**Risk:** Published codes and URLs outlive the implementation that introduced
them.

**Mitigation:** Limit codes to durable problem identities. Never publish codes
for internal invariants or transient upstream bugs.

### 12.5 Documentation duplicates catalog text

**Risk:** The short fix and the long-form page disagree.

**Mitigation:** Treat the catalog as the short machine-facing source of truth,
keep pages explanatory, and enforce code/page existence with one drift check.

### 12.6 A young dependency changes direction

**Risk:** nostics' API or maintenance trajectory changes after adoption.

**Mitigation:** Use only the small stable core API, avoid build plugins and
reporter integrations, pin through the lockfile, and keep the catalog internal.
The narrow surface is straightforward to replace if necessary.

### 12.7 Error identity changes for converted call sites

**Risk:** `Diagnostic.name` is the stable code rather than `Error`, and hidden
consumers may inspect it.

**Mitigation:** Treat the conversion as a documented user-facing improvement
in the next prerelease. Update contract tests and release notes. Do not convert
already structured public error classes.

---

## 13. Alternatives considered

### 13.1 Keep anonymous strings

This is the lowest-maintenance option, but setup and upgrade failures remain
hard to search, document, and assert without coupling tests to complete prose.
It does not meet the stable-diagnostic goal.

### 13.2 Build a local diagnostic framework

A small local class could provide `code`, `fix`, and `docs`. It would initially
be simple, but Ginko would own typing, formatting, causes, sources,
serialization, and future maintenance. nostics already provides the required
small core without runtime dependencies.

This alternative becomes preferable if Ginko declines to maintain public docs
pages. Without the registry, nostics offers too little benefit over a direct
local typed error.

### 13.3 Migrate all Ginko errors to nostics

Rejected. Existing pipeline, provider, HTTP, portability, CMS, and doctor
models carry semantics that nostics does not replace. A full migration would
lose information or add adapters, compatibility paths, and duplicated codes.

### 13.4 Wrap existing structured errors in diagnostics

Rejected. Wrapping would create two identities and two sources of truth for one
failure. Boundaries should expose their existing canonical error directly.

### 13.5 Add nostics only for warnings

Rejected for the initial slice. Nuxt/consola owns warning presentation, while
nostics reporters run at creation time. Integrating both safely would require
additional reporting structure without evidence that warnings are the highest
value surface.

### 13.6 Use production stripping and the Vite collector

Rejected. The proposed diagnostics are thrown during setup/build and must
survive production. Browser collection and telemetry are outside Ginko
Content's current requirements.

---

## 14. Implementation checklist

- [ ] Confirm the stable documentation URL shape.
- [ ] Add `nostics` to the published package dependencies.
- [ ] Add `packages/content/src/module/diagnostics.ts`.
- [ ] Define the first four codes with concrete fixes.
- [ ] Convert each selected call site with a hard cutover.
- [ ] Preserve causes and real user-owned source paths where available.
- [ ] Add one documentation page per code.
- [ ] Add the code/page drift check to an existing validation gate.
- [ ] Update focused unit and module contract tests.
- [ ] Add real output coverage for development and production mode.
- [ ] Verify diagnostics appear exactly once.
- [ ] Verify no public export was added.
- [ ] Verify pure-runtime subpaths do not load nostics.
- [ ] Run focused tests, docs checks, package contracts, and packed consumer.
- [ ] Run `pnpm verify` once before handoff.
- [ ] Add a changelog/release note describing stable diagnostic codes.

---

## 15. References

- [nostics repository](https://github.com/vercel-labs/nostics)
- [nostics releases](https://github.com/vercel-labs/nostics/releases)
- [nostics npm metadata](https://registry.npmjs.org/nostics/latest)
- `packages/content/src/core/errors.ts`
- `packages/content/src/core/provider-errors.ts`
- `packages/content/src/portability/errors.ts`
- `packages/content/src/cli/doctor/types.ts`
- `packages/content/src/module.ts`
- `packages/content/src/module/validation.ts`
- `packages/content/src/module/options.ts`
- `packages/content/src/module/route-meta-validation.ts`
