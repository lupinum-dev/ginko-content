# Ginko Content 0.3 Data Source And Portability Addendum

Status: implementation candidate

Target: `0.3.0-rc.2`, followed by `0.3.0`

Baseline: Ginko Content `0.2.1`; this addendum and `VNEXT.md` ship together as
one coordinated `0.3.0` release.

Last reviewed: 2026-07-13

## 1. Authority

This document is the data-source and portability addendum to the Ginko Content
`0.3` contracts and implementation order in `VNEXT.md`. The coordinated
[Ginko CMS vNext plan](../ginko-cms/ginko-cms-complete-migration-plan.md) owns
CMS implementation, exact cross-repository artifacts, and release approval.
Together, `VNEXT.md` and this addendum describe the complete `0.3` release from
the published `0.2.1` baseline; there is no intermediate unpublished release.

An implementation change that contradicts this file requires a reviewed spec
amendment first. Developers must not invent missing semantics while coding.

## 2. Executive Decision

Ginko Content `0.3` ships:

1. a framework-neutral, bounded runtime `ContentDataSource<Context>`;
2. the official Nuxt/H3 binder for that data source;
3. one resolved content contract and canonical contract hash;
4. a normative portable document model;
5. deterministic Markdown/MDC/YAML/JSON and directory codecs;
6. structural reference and asset handling;
7. observable protocol conformance tests.

It does not ship generic transactional import/export ports. Node and Ginko CMS
first implement concrete vertical slices using the codecs. A public source/target
protocol is considered later only after Node, Ginko CMS, and a second real
backend demonstrate the same state machine.

The product boundary is:

```text
Ginko Content owns content meaning, codecs, validation, and read integration.
Adapters own authorization, persistence, transactions, retries, and storage.
```

## 3. Release Scope

### Included

- immutable published portability snapshots;
- filesystem import into CMS drafts;
- deterministic files and content-addressed assets;
- raw MDC preservation and a defined syntax policy;
- H3-neutral read adapters;
- strict local-tarball development and candidate verification;
- coordinated removal of `/cms-import` after CMS migrates.

### Deferred

- working/draft export;
- immutable editorial checkpoints;
- generic `PortableSnapshotSource` and `PortableImportTarget` APIs;
- production Cloudflare, SQL, or remote-CMS adapters;
- Studio bulk portability UI;
- MCP bulk portability;
- archive wrappers;
- cross-run global asset deduplication;
- operational certification branding.

### Prohibited

- live Git/CMS synchronization or dual writes;
- generic repository, database, HTTP, job, or workflow frameworks;
- Ginko-owned authentication or authorization;
- byte-identical author formatting claims;
- automatic remote-asset downloads;
- backend IDs, credentials, signed URLs, or audit records in portable files;
- Node, Nuxt, H3, Convex, Cloudflare, or vendor dependencies in pure entries.

## 4. Canonical Ownership

| Concept                                      | Canonical owner                        | Derived consumers                    |
| -------------------------------------------- | -------------------------------------- | ------------------------------------ |
| collections, fields, locales, routing policy | resolved content contract              | runtime, CMS, codecs                 |
| logical identity                             | `(collection, canonicalKey)`           | locales, relations, adapters         |
| locale variant                               | `(collection, canonicalKey, locale)`   | files, queries, CMS rows             |
| authored route inputs                        | slug, parent identity, order           | route projector, navigation          |
| final public path and alternates             | Ginko Content projector                | provider output, sitemap             |
| shared/localized field classification        | resolved contract                      | codecs, CMS editor                   |
| editable body                                | raw MDC                                | AST, TOC, search text, render output |
| portable file mapping                        | Ginko Content codec                    | Node and CMS tooling                 |
| asset byte identity                          | SHA-256 of verified bytes              | directory and CMS storage            |
| runtime cache                                | configured Ginko Content cache adapter | H3 binder                            |
| auth, transactions, receipts, cleanup        | adapter                                | operational evidence                 |

There is no separate CMS policy artifact. Evolve the existing `CmsContract` into
`ResolvedContentContractV1` or rename it in the `0.3` hard cutover. The exact
artifact installed by CMS is the exact artifact used by portability.

## 5. Canonical Contract And Hashing

### 5.1 Resolved Contract

The resolved contract contains exactly:

```ts
interface ResolvedContentContractV1 {
  format: 'ginko-content-contract'
  version: 1
  defaultLocale: string
  locales: string[]
  localeFallbacks: Record<string, string[]>
  collections: Record<string, ResolvedContentCollectionV1>
}
```

Each collection records its page/data kind, shared and localized field schemas,
default locale, allowed locales, route mode, path prefixes, slug mode, root
rules, relation targets, media types, and supported component policy reference.
No Studio layout, member, workflow, or persistence setting belongs here.

`ResolvedContentCollectionV1` is a closed runtime value, not an alias for user
configuration. It contains:

```ts
interface ResolvedContentCollectionV1 {
  id: string
  kind: 'page' | 'data'
  structure: 'flat' | 'tree'
  defaultLocale: string
  locales: string[]
  routing: {
    mode: 'route' | 'none'
    pathPrefix: string
    localizedPathPrefixes: Record<string, string> | null
    localizedSingletonPaths: Record<string, string> | null
    slugMode: 'shared' | 'localized' | 'stable' | 'localizedStable'
    rootSlug: string | null
    singleton: boolean
    allowMultipleRoots: boolean
  }
  fields: ResolvedContentFieldV1[]
  portable: {
    format: 'mdc' | 'yaml' | 'json'
    bodyField: string | null
  }
  componentPolicy: PortableComponentPolicyV1
}
```

`ResolvedContentFieldV1` is the closed, recursively normalized successor to
`CmsFieldContract`: it retains data type, role, required/localized flags,
relation target, nested fields, defaults, options, and validation limits. It
removes `editor`, free-form `settings`, display labels, icons, and UI-only
`divider`/`section` pseudo-fields. Shared and localized field keys must be
disjoint at every object level; exactly zero or one field may have role `body`.
Page collections require `portable.format = 'mdc'` and a richtext body field.
Data collections require YAML or JSON and no body field.

```ts
type ResolvedContentFieldTypeV1 =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'slug'
  | 'email'
  | 'url'
  | 'number'
  | 'range'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'toggle'
  | 'date'
  | 'datetime'
  | 'time'
  | 'json'
  | 'object'
  | 'array'
  | 'blocks'
  | 'relation'
  | 'relations'
  | 'image'
  | 'images'
  | 'file'
  | 'icon'
  | 'code'
  | 'color'

interface ResolvedContentFieldV1 {
  key: string
  type: ResolvedContentFieldTypeV1
  role: 'title' | 'description' | 'body' | null
  required: boolean
  localized: boolean
  searchable: boolean
  sortable: boolean
  default: { present: false } | { present: true; value: JsonValue }
  options: string[] | null
  relation: {
    collection: string
    multiple: boolean
  } | null
  media: {
    mediaTypes: PortableMediaType[]
    aspectRatio: string | null
  } | null
  fields: ResolvedContentFieldV1[] | null
  validation: ResolvedContentValidationV1 | null
  min: number | null
  max: number | null
  step: number | null
  slugFrom: string | null
  language: string | null
}
```

```ts
type ResolvedContentValidationV1 =
  | {
      kind: 'string'
      minLength: number | null
      maxLength: number | null
      format: 'email' | 'url' | 'date' | 'datetime' | 'time' | null
    }
  | { kind: 'number'; min: number | null; max: number | null; integer: boolean }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: string[] }
  | {
      kind: 'array'
      minItems: number | null
      maxItems: number | null
      element: ResolvedContentValidationV1
    }
  | { kind: 'object'; fields: Record<string, ResolvedContentValidationV1> }
  | { kind: 'nullable'; inner: ResolvedContentValidationV1 }
```

An absent default is distinct from an explicit null default. Validation contains
no functions, regex objects, opaque schema bytes, or `unknown` values. The
builder rejects invalid field/type combinations rather than retaining irrelevant
properties: relation is non-null only for relation(s), media only for
image(s)/file, fields only for object/array/blocks, options only for
select/multiselect/radio, numeric limits only for number/range, and `slugFrom`
only for slug. Implementation should use a discriminated union internally, but
its canonical JSON must match this normalized shape exactly.

CMS-only field layout is a separate `CmsEditorialLayout` keyed by contract
collection and field IDs. It may contain labels, icons, widths, grouping, and
conditional presentation only. CMS validates every key against the resolved
contract during setup. Layout never changes the content contract hash and
cannot specify locales, routes, field types, defaults, validation, or identity.

The component policy is embedded in the resolved contract so directory parsing
does not depend on an unindexed artifact:

```ts
interface PortableComponentPolicyV1 {
  components: Record<
    string,
    {
      kind: 'block' | 'inline'
      props: Record<
        string,
        {
          type: 'string' | 'number' | 'boolean' | 'json' | 'asset'
          required: boolean
        }
      >
      slots: string[]
      media: {
        sourceProp: string
        altProp: string | null
        titleProp: string | null
        filenameProp: string | null
      } | null
    }
  >
}
```

Component and prop names are case-sensitive. `default` is the implicit slot.
When `media` is present, `sourceProp` names a declared `asset` prop and the
optional presentation props name declared string props. Unknown props, slots,
components, dynamic bindings, and event-like names fail portable validation.

The builder is deterministic. CMS installs the entire artifact plus its hash,
not a separately assembled collection array.

Each `localeFallbacks[locale]` is an ordered, duplicate-free list of declared
locales, excludes the source locale, and ends in the site default when the source
is not already the default. Cycles are rejected. A collection filters that list
to its allowed locales and then appends its collection default if needed.

### 5.2 Canonical JSON

All cross-runtime hashes use RFC 8785 JSON Canonicalization Scheme bytes with
these input restrictions:

- JSON objects, arrays, strings, booleans, null, and finite numbers only;
- integer values must be within JavaScript's safe integer range;
- `undefined`, holes, `bigint`, functions, symbols, non-finite numbers, cycles,
  getters, proxies, dates, maps, sets, and class instances are rejected;
- `-0` canonicalizes to `0` as required by RFC 8785;
- strings are hashed as their exact Unicode scalar sequence; filesystem paths
  are normalized separately to NFC.
- lone UTF-16 surrogates are rejected before canonicalization;
- accepted in-memory objects have only `Object.prototype` or a null prototype,
  enumerable string keys, and own data descriptors; accessors and exotic
  prototypes are rejected;
- untrusted byte input is parsed as JSON before validation. The API does not
  claim to safely introspect arbitrary hostile proxies supplied as live
  JavaScript objects.

```ts
canonicalJsonBytes(value: JsonValue): Uint8Array
sha256Hex(bytes: Uint8Array | AsyncIterable<Uint8Array>): Promise<string>
hashCanonicalJson(value: JsonValue): Promise<string>
```

Use one incremental SHA-256 implementation that imports in Node, Worker V8, and
Convex. Do not use `crypto.subtle.digest()` for unbounded assets because it
requires the complete buffer. Freeze shared vectors for Unicode, `-0`, decimal
exponents, unsafe integers, nested key order, nulls, and rejected values.

## 6. Portable Document V1

### 6.1 Normative Model

One portable document represents one locale variant:

```ts
interface PortableDocumentV1 {
  format: 'ginko-content-document'
  version: 1
  collection: string
  canonicalKey: string
  locale: string
  slug: string
  parentCanonicalKey: string | null
  order: string | null
  shared: JsonObject
  localized: JsonObject
  body: PortableBodyV1 | null
  visibility: {
    navigation: boolean
    search: boolean
    sitemap: boolean
  }
}

type PortableBodyV1 = {
  kind: 'mdc'
  source: string
}
```

Rules:

- `collection`, `canonicalKey`, and `locale` are always materialized;
- `collection`, `canonicalKey`, `locale`, and slug are valid Unicode scalar
  strings already normalized to NFC; non-NFC input is rejected rather than
  silently normalized;
- `canonicalKey` is opaque and never derived from the current filename, slug,
  route, or locale;
- file moves and route changes do not change identity;
- CMS stores the exact `canonicalKey` in its retained `stableId` column;
- legacy `stableId` or `translationKey` maps once to `canonicalKey` during
  migration; the new codec has no path-derived fallback;
- `parentCanonicalKey` references an identity in the same collection;
- final route paths, alternates, navigation trees, search indexes, sitemap
  entries, AST, TOC, and public projections are derived and excluded;
- portable visibility contains authored public-projection inputs only; it never
  records CMS workflow state, and there is no portable `draft` or `published`
  field;
- shared field values repeat in each locale file for ordinary filesystem use;
  the codec rejects divergence across variants of one identity;
- the resolved contract decides which fields belong in `shared` and
  `localized`; unknown, misplaced, or duplicate fields fail.

Topology invariants are closed:

| Collection contract | `slug`                    | `parentCanonicalKey` | `order`      | visibility        |
| ------------------- | ------------------------- | -------------------- | ------------ | ----------------- |
| data / route `none` | empty string              | null                 | null         | all false         |
| page / flat / route | non-empty                 | null                 | null         | authored booleans |
| page / tree / route | non-empty                 | root rule below      | rank or null | authored booleans |
| singleton / route   | configured singleton slug | null                 | null         | authored booleans |

For `slugMode: shared | stable`, every locale variant of one identity has the
same slug. For `localized | localizedStable`, variants may differ. Slugs are
NFC, contain one route segment, and contain no slash, dot segment, query, or
fragment. A configured root entry uses `rootSlug`, has no parent, and is unique
per locale. Every other tree page requires a parent unless the collection
explicitly permits multiple roots. Flat/data/singleton documents reject a
parent.

`order` is either null or an uppercase fixed-width 16-character hexadecimal
unsigned rank. Ordering compares rank lexicographically, then canonical key as
the stable tie-breaker. Ranks need not be contiguous. Data and flat/singleton
collections reject order. `navigation`, `search`, and `sitemap` may be true only
for route-backed pages and remain authored public-projection inputs; collection
policy may force one false but never silently turn false into true.

### 6.2 Markdown/MDC Frontmatter Mapping

Every Markdown/MDC file contains this reserved namespace:

```yaml
---
ginko:
  version: 1
  collection: docs
  canonicalKey: docs.introduction
  locale: en
  slug: introduction
  parentCanonicalKey: null
  order: '0000000000010000'
  visibility:
    navigation: true
    search: true
    sitemap: true
title: Introduction
tags:
  - guide
---
```

Mapping is contract-driven:

- reserved `ginko` contains identity, hierarchy, order, and visibility only;
- shared/localized content fields retain their configured field names at the
  frontmatter top level;
- the codec classifies them through the resolved contract;
- the Markdown body maps only to the configured body-role field;
- a second body value in frontmatter is rejected;
- `ginko`, legacy projection fields, CMS IDs, final paths, AST, TOC, search
  text, and provider envelopes cannot be user fields.

### 6.3 YAML And JSON Mapping

Data collections use `.yml` by default. JSON is emitted only when explicitly
selected by the collection's portable format setting. Their root shape is:

```yaml
ginko:
  version: 1
  collection: authors
  canonicalKey: author.ada
  locale: en
  slug: ''
  parentCanonicalKey: null
  order: null
  visibility:
    navigation: false
    search: false
    sitemap: false
fields:
  name: Ada Lovelace
```

`fields` contains the union of shared and localized values; the resolved
contract splits them. A route-backed collection must use Markdown/MDC.

### 6.4 Canonical File Paths And Bytes

The deterministic writer uses reversible percent-encoded identity segments:

```text
content/<collection-segment>/<canonical-key-segment>/<locale-segment>.md
content/<collection-segment>/<canonical-key-segment>/<locale-segment>.yml
content/<collection-segment>/<canonical-key-segment>/<locale-segment>.json
```

Require each source string to already be NFC, encode its UTF-8 bytes, retain
only ASCII `A-Z a-z 0-9 . _ -`, and percent-encode every other byte using
uppercase hex.
`%` is always encoded. Reject empty, dot, dot-dot, reserved-device, or segments
over 240 encoded bytes. Decoding must reproduce the materialized identity; the
path is not itself identity. A reader accepts safe moved files, while the
deterministic writer returns them to the canonical path above.

Canonical document bytes use UTF-8 without BOM, LF line endings, and exactly one
trailing LF. Markdown/MDC uses `---` plus LF, canonical YAML, `---` plus LF, and
normalized raw MDC source. Body normalization rejects a BOM anywhere in the
body, converts CRLF and lone CR to LF, preserves every other code point and all
leading newlines, removes only trailing LF characters, then lets the document
writer append exactly one final LF. YAML and JSON inputs reject duplicate keys,
aliases, anchors, tags, merge keys, non-string object keys, non-finite numbers,
and implementation-specific scalar types.

The canonical YAML emitter uses two-space indentation, double-quoted JSON
string escaping, JCS number spelling, lowercase booleans/null, block mappings,
and block sequences. It emits `ginko` first with keys in the model order, then
content fields in resolved-contract order. Nested object keys use Unicode code
point order. Empty arrays/objects use `[]`/`{}`. Multiline strings remain
double-quoted with escaped newlines; folded/literal style is accepted as input
but not emitted. Canonical JSON uses RFC 8785 bytes plus one trailing LF.

Missing optional fields remain absent. Explicit null remains null. Defaults are
not materialized by the codec; the resolved validator applies them when deriving
runtime content. Dates, datetimes, and times are strings in strict
`YYYY-MM-DD`, RFC 3339 with an explicit offset, and `HH:mm:ss` form respectively.
The codec rejects values outside their field type before writing.

Field mapping is exact:

- scalar text-like fields map to strings; number/range to finite numbers;
- checkbox/toggle map to booleans;
- select/radio map to one configured string and multiselect to an ordered string
  array;
- object, array, blocks, and JSON map recursively to validated JSON values;
- relation/relations map to `PortableReferenceV1` or an ordered array;
- image/file map to `PortableAssetReferenceV1` or null and images maps to an
  ordered array;
- the one body-role richtext field maps only to `body.source`, not frontmatter.

### 6.5 References

References use canonical identity, never a route or backend ID:

```ts
type PortableReferenceV1 = {
  collection: string
  canonicalKey: string
}
```

Scalar relation fields contain one reference or null. Multi-relation fields
contain an ordered array. A relation target is locale-neutral and is valid when
the target identity has at least its collection default-locale variant. Runtime
resolution tries the requested locale and then the resolved contract fallback
policy. A routed tree child must have a concrete parent variant in the child's
locale; fallback cannot manufacture route ancestry.

Import is two-pass: establish every logical identity and locale variant first,
then resolve parents and relations. Parent graphs are validated independently
per collection and locale. Missing targets, wrong collections, missing required
parent variants, self-parenting, and cycles block apply.

## 7. Portable Directory And Manifest

### 7.1 Layout

```text
content/
public/ginko-assets/
.ginko/content-contract.json
.ginko/portable.json
```

The destination must not exist. The initial implementation never replaces or
merges a non-empty directory.

### 7.2 Manifest

```ts
interface PortableManifestV1 {
  format: 'ginko-content-portable'
  version: 1
  contract: {
    file: '.ginko/content-contract.json'
    sha256: string
  }
  documents: Array<{
    identity: {
      collection: string
      canonicalKey: string
      locale: string
    }
    file: string
    sha256: string
  }>
  assets: PortableAssetBlobV1[]
}

interface PortableAssetBlobV1 {
  sha256: string
  file: string
  bytes: number
  mediaType: PortableMediaType
}
```

The manifest has no independent identity or policy facts.

### 7.3 Rebuild Algorithm

`rebuildPortableManifest(root)` is normative:

1. read and validate `.ginko/content-contract.json`;
2. hash its canonical JSON bytes;
3. enumerate normalized supported content files in sorted POSIX path order;
4. parse every file through the contract and obtain `PortableDocumentV1`;
5. reject duplicate variant identities and divergent shared fields;
6. structurally collect local asset references;
7. verify every referenced asset's hash, bytes, media signature, and extension;
8. reject unreferenced files in `public/ginko-assets`;
9. reject every filesystem entry outside `content/**`,
   `public/ginko-assets/**`, `.ginko/content-contract.json`, and
   `.ginko/portable.json`; reject unsupported content extensions, extra `.ginko`
   files, empty directories, and non-regular entries;
10. sort documents by collection, canonical key, locale, then file;
11. sort assets by SHA-256;
12. serialize the manifest with canonical JSON plus one trailing LF.

Deleting `.ginko/portable.json` from an otherwise unchanged directory and
rebuilding must reproduce it byte-for-byte. Moving a file preserves its
materialized identity and document hash but necessarily changes its manifest
`file` value. Running the deterministic writer restores the canonical identity-
based path. Reordering filesystem enumeration has no effect. Changing a
document, contract, asset, or file path changes only the corresponding indexed
fact and the manifest bytes.

## 8. Asset Semantics

### 8.1 Byte Identity

```ts
type PortableMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

type PortableAssetReferenceV1 =
  | {
      kind: 'local'
      path: `/ginko-assets/${string}`
      sha256: string
      bytes: number
      mediaType: PortableMediaType
      originalFilename: string | null
    }
  | {
      kind: 'external'
      url: `https://${string}`
    }
```

A local `path` must equal `/ginko-assets/<sha256>.<extension>` and maps to the
directory file `public/ginko-assets/<sha256>.<extension>`. The digest is 64
lowercase hex characters. Canonical extensions are `png`, `jpg`, `gif`, and
`webp`; JPEG always uses `jpg`. `bytes` is a non-negative safe integer and
must match the stream. `originalFilename`, when present, is NFC, contains no path
separator/control character, and is at most 255 UTF-8 bytes.

Portable blobs use:

```text
public/ginko-assets/<sha256>.<verified-extension>
```

The blob identity is verified bytes, not CMS asset ID or filename. Identical
bytes share one blob. Same filename with different bytes produces distinct
blobs.

Original filename and presentation metadata belong to the logical field or MDC
reference when the field syntax supports them. They are not blob identity and
are not guaranteed when the source format does not model them.

### 8.2 Initial Media Policy

Supported verified types:

- PNG;
- JPEG;
- GIF;
- WebP;

Managed PDF is deferred until a hardened PDF profile and parser are accepted;
PDF may remain an external HTTPS reference. Reject SVG, HTML, XML, PDF blobs,
archives, executables, unknown signatures, MIME/signature mismatches, and bytes
after the format's valid terminal structure. Verification parses the complete
container, validates checksums/marker structure where the format provides them,
and enforces maximum width/height 16,384, maximum 100,000,000 pixels, maximum
100 animation frames, and maximum 512 MiB calculated decoded bytes.

External references must be HTTPS, at most 2048 characters, contain no
username/password, query string, or fragment, and are preserved without
fetching. Reject `http:`, `data:`, `blob:`, `file:`, and scriptable protocols.
Signed or token-bearing remote URLs are therefore not portable in V1.

### 8.3 Structural Rewriting

Collect and rewrite only:

- contract fields of type `image`, `images`, or `file`;
- Markdown image/link nodes explicitly classified as media;
- registered MDC media component props declared by the component policy.

Never scan or replace arbitrary strings. Target imports recompute hashes and
verify bytes; they never trust manifest claims alone.

For typed fields, the serialized value is the exact union above. For Markdown,
the destination URL is the local `path` or external `url`; alt/title remain
ordinary Markdown node properties. For registered MDC media props, the policy
marks one prop as the asset URL and separately declares any alt, title, or
filename prop. The parser produces the union plus those declared presentation
fields; the writer restores them without inventing metadata.

## 9. Markdown/MDC Policy

### 9.1 Portable And Studio-Editable

Initial syntax supported through a Studio no-op round trip:

- headings, paragraphs, text, emphasis, strong, strike;
- links and images using allowed URLs;
- ordered/unordered/task lists;
- blockquotes, thematic breaks, inline/fenced code;
- tables with header/body cells;
- registered block and inline MDC components;
- static JSON-safe component props;
- default and named component slots.

### 9.2 Portable Raw-Only

The codec may preserve these, but Studio must use raw mode and must not open them
in the visual editor:

- safe HTML comments;
- registered components without a Studio editor mapping;
- safe static syntax explicitly covered by the portable codec but absent from
  the Studio support matrix.

### 9.3 Rejected

- raw HTML elements;
- script, style, iframe, object, embed, SVG, or active document nodes;
- event-handler props;
- JavaScript/Vue expressions and dynamic bindings;
- unsafe URL protocols;
- unknown active components;
- constructs the codec cannot serialize semantically.

Import and publication fail with an exact location and structured code. Nothing
is silently stripped, flattened, or replaced with placeholder text.

The acceptance comparison is parsed semantic AST equality, not normalized-text
fixed-point convergence.

The portability package owns `parsePortableMdc(source, componentPolicy)` and
`serializePortableMdc(ast, componentPolicy)`. Both use the package's pinned
Comark parser and one normalized AST projection that retains node type, ordered
children, literal value, URL/title, code language/meta, table alignment,
component tag, validated static props, and named-slot structure. It removes only
source positions before semantic comparison. Object prop keys are compared in
Unicode code point order; child, slot, list, and table order remains significant.

`classifyPortableMdc()` is Content-owned and returns `portable | rejected` plus
exact locations. It knows only the resolved component policy. Ginko CMS owns
`classifyStudioMdc(ast, editorCapabilities)`, where the capability map names the
exact portable tags/nodes/props the installed visual editor can preserve. It
returns `editable | raw-only` and cannot convert a Content rejection into a
valid document.

A raw-only document is never parsed through TipTap; a rejected document cannot
be imported or published. Content fixtures are normative for portable/rejected
syntax. CMS fixtures independently prove editable/raw-only classification and
semantic no-op saves for every advertised editor capability.

## 10. Runtime Data Source

### 10.1 Pure Contract

```ts
interface ContentDataSourceCacheHint {
  tags: string[]
  paths: string[]
  maxAge: number | null
  swr: number | null
  etag: string | null
  lastModified: number | null
}

interface ContentDataSourceResult<T> {
  data: T
  cache: ContentDataSourceCacheHint | false
}

type BoundedContentProviderQuery = Omit<ContentProviderQuery, 'plan'> & {
  plan:
    | (Omit<ContentQueryPlan, 'mode' | 'limit'> & {
        mode: 'all'
        limit: number
      })
    | (Omit<ContentQueryPlan, 'mode' | 'limit' | 'paging'> & {
        mode: 'first'
        limit: 1
        paging?: never
      })
    | (Omit<ContentQueryPlan, 'mode' | 'limit' | 'paging'> & {
        mode: 'count'
        limit?: never
        paging?: never
      })
}

interface ContentDataSourceControl {
  signal: AbortSignal
  deadlineAt: number
}

interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
  snapshot: string
}

interface ContentDataSourceSiteDataResponse {
  key: string
  locale: string | null
  data: JsonValue | null
  updatedAt: number | null
}

interface ContentDataSource<Context> {
  readonly name: string
  readonly capabilities: ContentDataSourceCapabilities

  query(
    context: Context,
    query: BoundedContentProviderQuery,
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<ContentQueryResponse<ProviderDocumentInput>>>

  navigation?(
    context: Context,
    query: BoundedContentProviderQuery,
    options: ContentProviderNavigationOptions & { limit: number },
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<ContentProviderNavigationItem[]>>

  surroundings?(
    context: Context,
    collection: string,
    contentPath: string,
    options: ContentProviderSurroundingsOptions,
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<Array<ContentProviderSurroundItem | null>>>

  search?(
    context: Context,
    request: ContentProviderSearchRequest & { limit: number },
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<ContentProviderSearchResult[]>>

  siteData?(
    context: Context,
    request: ContentProviderSiteDataRequest,
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<ContentDataSourceSiteDataResponse>>

  routes?(
    context: Context,
    request: { cursor: string | null; limit: number },
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<CursorPage<ContentRouteRecord>>>
}
```

There are no caller-selected result generics, generic runtime asset lookup, or
provider-owned invalidation method.

### 10.2 Bounds

Core ceilings apply before dispatch even if an adapter advertises more:

```ts
MAX_QUERY_PAGE_SIZE = 100
MAX_SEARCH_RESULTS = 100
MAX_ROUTE_PAGE_SIZE = 250
MAX_TOTAL_ROUTES = 100_000
MAX_NAVIGATION_NODES = 2_000
MAX_SURROUND_ITEMS = 2
MAX_SITE_DATA_BYTES = 256 * 1024
MAX_PROVIDER_ERROR_MESSAGE_BYTES = 2 * 1024
MAX_PROVIDER_ERROR_DETAILS_BYTES = 16 * 1024
MAX_CACHE_TAGS = 64
MAX_CACHE_PATHS = 64
MAX_CACHE_KEY_BYTES = 256
MAX_CACHE_TTL_SECONDS = 86_400
MAX_BACKEND_DURATION_MS = 10_000
```

The binder also validates returned counts and serialized sizes. Routes are
paged; a provider cannot return a 100,000-row roster in one value. Every
caller supplies a positive integer limit. A request above the core ceiling is
rejected with `REQUEST_LIMIT_EXCEEDED`, never silently clamped. For an all-mode
query, `plan.limit` is mandatory and any `paging.limit` must equal it. First mode
is intrinsically one; count returns only a bounded scalar. Navigation remains a
single bounded operation in V1; a backend must apply the limit before allocating
the result and return `RESULT_LIMIT_EXCEEDED` when the complete navigation
result would exceed it.

Route cursors are opaque adapter values bound to source name, normalized request
scope, stable sort definition, and snapshot generation. Pages are ordered by
`(collection, canonicalKey, locale)` with an adapter-stable unique tie-breaker.
`nextCursor: null` means exhaustion. Replaying a cursor returns the same page
while its snapshot is valid; a cursor used with another scope/source or after
snapshot expiry fails `CURSOR_INVALID`. Adapters must not skip or duplicate
records during one enumeration. Core also enforces a configured maximum total
route count while consuming pages.

The binder creates an `AbortController` and absolute deadline for every backend
operation, capped at 10 seconds. It aborts on request disposal or deadline.
Adapters must observe `control.signal`; exceeding the deadline maps to
`BACKEND_TIMEOUT`. An adapter that resolves after abort is ignored before
projection, cache hints, logging, or any other observable effect.

`siteData` preserves the existing envelope. The binder verifies the response
key equals the request key, locale equals the normalized requested locale (or
null), `updatedAt` is null or a non-negative safe-integer epoch millisecond, and
data is bounded JSON. It then maps the envelope unchanged to the public runtime.

### 10.3 Capabilities

```ts
interface ContentDataSourceCapabilities {
  protocol: 'ginko-content-data-source/v1'
  query: {
    operators: readonly ContentQueryOperator[]
    pagination: readonly ContentProviderPaginationMode[]
    maxPageSize: number
  }
}
```

Optional operation support is inferred from method presence. Do not add method
booleans. Registration and conformance execute every advertised semantic
capability.

### 10.4 H3 Binder And Cache Ownership

`bindContentProvider({ source, createContext })` lives in `/provider` and:

1. creates one context per H3 request and source;
2. reuses it for nested operations;
3. validates input before dispatch and output before projection/cache;
4. keeps requested identity authoritative;
5. merges validated cache hints into the request-local accumulator;
6. leaves cache application to the one response finalizer;
7. normalizes structured, recursively redacted errors;
8. never serializes the context or backend causes.

`defineContentDataSource()` is not public. TypeScript `satisfies` plus binder
validation is sufficient.

`false` is sticky while merging. Preview, authenticated-private, and error
responses force `false`. Tags and paths are deduplicated and bounded by the
limits above; every value is NFC, credential-free, and within the byte limit.
`maxAge` and `swr` are integer seconds in range and merge to the smallest
present value. `lastModified` is a non-negative safe-integer epoch millisecond
and merges to the greatest present value. Equal ETags survive; multiple distinct
ETags merge to `sha256:` plus the SHA-256 of the JCS-sorted unique ETag array, so
nested operation order cannot change the result. The binder converts the epoch
to the existing runtime cache adapter representation only after validation. The
response finalizer invokes that adapter at most once after all nested operations
finish.

The configured Ginko Content cache adapter is the sole runtime cache authority.
Runtime data sources must not own a second cache. In the same hard-cutover
commit, move the current `provider.invalidate` call sites to the application
cache invalidation API, migrate every built-in provider, and remove the provider
method. Before/after contract tests must prove the same tags are invalidated
once. No released final topology contains both invalidation paths.

Runtime backends resolve authorized public asset URLs inside their document
query while collection, canonical identity, locale, publication, and field
contract are available. Ginko Content validates the returned public facts.

## 11. Errors And Security Limits

Pure boundaries use closed error codes. Public details contain only bounded
string, number, boolean, or null scalars. No nested hostile data.

```ts
type GinkoBoundaryOperation =
  | 'data-source.query'
  | 'data-source.navigation'
  | 'data-source.surroundings'
  | 'data-source.search'
  | 'data-source.siteData'
  | 'data-source.routes'
  | 'portability.parse'
  | 'portability.serialize'
  | 'portability.hash'
  | 'portability.rebuildManifest'
  | 'portability.validateReferences'
  | 'portability.validateAssets'
  | 'portability.validateMdc'
  | 'directory.read'
  | 'directory.write'
  | 'directory.verify'

type GinkoBoundaryErrorCode = PortabilityErrorCode | DataSourceErrorCode

interface GinkoBoundaryError {
  name: 'GinkoBoundaryError'
  boundary: 'data-source' | 'portability' | 'directory'
  operation: GinkoBoundaryOperation
  code: GinkoBoundaryErrorCode
  message: string
  details: Record<string, string | number | boolean | null>
  location: {
    file: string | null
    line: number | null
    column: number | null
    path: Array<string | number>
  } | null
}
```

Line and column are one-based UTF-16 source coordinates; `path` is a validated
model/JSON path. Files are safe relative POSIX paths. Unknown exceptions map to
`ADAPTER_FAILURE` or the boundary's most specific closed code. Public messages
are stable product text, not backend exception messages.

Required portability codes:

```text
CONTRACT_INVALID
CONTRACT_HASH_MISMATCH
DOCUMENT_INVALID
IDENTITY_CONFLICT
SHARED_FIELD_DIVERGENCE
REFERENCE_MISSING
REFERENCE_CYCLE
MDC_UNSUPPORTED
PATH_INVALID
PATH_COLLISION
LIMIT_EXCEEDED
ASSET_MISSING
ASSET_TYPE_UNSUPPORTED
ASSET_INTEGRITY_FAILED
DESTINATION_EXISTS
```

Required data-source codes:

```text
PROTOCOL_UNSUPPORTED
CAPABILITY_UNSUPPORTED
QUERY_INVALID
REQUEST_LIMIT_EXCEEDED
CURSOR_INVALID
RESULT_INVALID
RESULT_LIMIT_EXCEEDED
IDENTITY_MISMATCH
BACKEND_TIMEOUT
BACKEND_UNAVAILABLE
ADAPTER_FAILURE
```

The two code blocks above are the exact `PortabilityErrorCode` and
`DataSourceErrorCode` unions. Request-limit violations use
`REQUEST_LIMIT_EXCEEDED`; oversized returned values use
`RESULT_LIMIT_EXCEEDED`. Unknown adapter exceptions map to `ADAPTER_FAILURE`,
deadline/abort to `BACKEND_TIMEOUT`, unknown returned shapes to `RESULT_INVALID`,
and unsupported version/capability to the corresponding closed code. Parser,
codec, and filesystem unknowns map to their most specific portability code and
never to an undeclared string.

Recursive redaction runs before message/details construction. Credentials,
cookies, API keys, deploy keys, signed URLs, causes, remote bodies, SQL, storage
bindings, documents, getters, proxies, and circular values cannot cross.

## 12. Node Directory Safety

Portable manifest paths are relative POSIX paths normalized to NFC.

Reject:

- absolute paths, empty segments, `.` and `..`;
- backslashes, NUL, control characters, or paths over 512 UTF-8 bytes;
- NFC duplicates and Unicode case-fold collisions;
- Windows device names, trailing dots/spaces, and platform-reserved names;
- symlinks, hard-link aliases, sockets, devices, and non-regular files;
- a destination that already exists.

V1 operates only on an operator-controlled root that is not concurrently
mutated by an adversary. Use `lstat`, no-follow opening where Node/platform
supports it, revalidate size/type after opening, and fail if observable identity
changes. These checks catch ordinary symlink replacement but do not claim
descriptor-relative race safety against a hostile process replacing parent
directories. Such environments must copy the bundle into an isolated root
first. The staging parent is likewise operator-controlled.

Initial limits:

```text
maximum content documents: 100,000
maximum total files: 200,000
maximum directory depth: 32
maximum document bytes: 2 MiB
maximum asset bytes: 25 MiB
maximum contract bytes: 4 MiB
maximum manifest bytes: 32 MiB
maximum total portable bytes: 10 GiB
```

Write into a newly created staging directory beside the requested destination,
verify it fully, then rename to the still-nonexistent destination. Cleanup is
bounded and retryable. Never overwrite existing content.

## 13. Conformance Levels

### Level 1: Protocol Conformance

Ginko Content publishes observable black-box suites for:

- data-source capabilities, bounds, paging, identity, cache hints, and errors;
- portable model parsing, serialization, hashing, rebuilding, references, MDC,
  assets, and directory safety;
- Node and real Worker-runtime import purity.

This level does not claim persistence durability or authorization.

### Level 2: Adapter Operational Evidence

Each adapter owns evidence for:

- authentication and authorization;
- restart/reopen durability;
- concurrent replay and transaction isolation;
- fault-after-effect/before-response behavior;
- controllable-clock expiry and cleanup;
- SSRF, DNS, redirect, rate-limit, and quota policy;
- deployment-specific storage consistency.

Release documentation says `protocol-conformant` only for Level 1. It says
`operationally certified` only when named Level-2 evidence is recorded against
an exact artifact and deployment shape.

## 14. Public Surface And Breaking Policy

`package.json.exports` is the canonical public allowlist. Generate or check
`meta/public-surface.json`, API documentation, declarations, and consumer probes
from it.

Final `0.3` additions:

```text
@lupinum/ginko-content/data-source
@lupinum/ginko-content/portability
@lupinum/ginko-content/portability/node
@lupinum/ginko-content/testing/data-source-contract
@lupinum/ginko-content/testing/portability-contract
```

`/provider` remains H3-facing. Do not publish a separate fixture-only entry;
fixtures are exported from the relevant testing contract.

`/cms-import` is removed in the coordinated pre-1.0 breaking release only after
Ginko CMS consumes the exact packed `/portability` replacement. Add negative
runtime/type probes and explicit migration documentation.

## 15. Local Tarball Workflow

Registry publication is not part of development.

### Development Lane

```bash
pnpm run dev:pack
```

Requirements:

- may pack a dirty tree;
- writes under `.pack/dev/`;
- records commit, dirty state, Node/pnpm versions, file manifest, and SHA-256;
- embeds the package-manifest version;
- packs to a temporary name, hashes it, then atomically renames it to
  `.pack/dev/<package>-<version>-dev.<commit>.<sha256>.tgz`;
- never overwrites or reuses a development artifact path;
- is accepted only through an explicit artifact path;
- never updates compatibility or release evidence.

### Release Candidate Lane

```bash
pnpm run release:pack
```

Requirements:

- clean accepted commit;
- exact version from the package manifest;
- two serial packs with identical archive bytes and SHA-256;
- the verified tarball and `release-artifact.json` under `.pack/`;
- release evidence records the exact commit, dirty state, runtime versions,
  archive hash, and reproducible pack count;
- downstream temporary consumers verify the expected hash before install.

Committed package manifests retain semver ranges. Machine-specific `file:` paths
are injected only into temporary consumers. Workspace, link, sibling source,
registry fallback, and absolute source imports fail candidate verification.
Every development probe creates a fresh consumer directory, manifest, lockfile,
store/cache location, and install, so two dirty packs with the same semver but
different hashes demonstrably load different bytes.

## 16. Implementation Order

1. freeze the resolved contract and RFC 8785/SHA-256 vectors;
2. add portable semantic fixtures;
3. implement the corrected pure data source and bounds;
4. migrate the filesystem provider and H3 binder without losing cache behavior;
5. implement `PortableDocumentV1` and frontmatter/data mappings;
6. implement references and two-pass graph validation;
7. implement the portable MDC syntax matrix and semantic tests;
8. implement structural asset handling and byte verification;
9. implement manifest rebuilding and the safe Node directory codec;
10. pack the Content development artifact;
11. implement the CMS-specific vertical slice against that tarball;
12. run Level-1 and adapter-owned CMS evidence;
13. remove `/cms-import` and duplicate CMS mapping in the same cutover;
14. create clean exact candidates and run coordinated verification.

## 17. Required Tests

- exact manifest deletion and byte-for-byte rebuild in an unchanged directory;
- file moves preserve identity, update only the indexed path, and canonical
  writing restores the identity-based path;
- identity stability across renamed files, slugs, routes, locales, and CMS export;
- shared-field divergence rejection;
- cross-runtime RFC 8785 and incremental SHA-256 vectors;
- cast-free external data-source implementation;
- boundary and boundary-plus-one for every operation;
- multipage route enumeration without whole-roster collection;
- cache invalidation migration with no loss or duplication;
- file -> codec -> file semantic equality for every field type;
- import -> Studio no-op -> publish -> export semantic MDC equality;
- raw-only syntax blocked from visual editing;
- unsafe syntax rejected rather than stripped;
- same bytes/different filenames and same filename/different bytes;
- wrong size/hash/type, truncation, invalid terminal bytes, dimension/pixel/
  frame/decoded-size limits, and unsupported PDF/SVG/archive media;
- reference forward resolution, missing targets, and cycles;
- path traversal, case/NFC collision, reserved names, symlink races, and existing
  destination;
- packed npm/pnpm consumers and a real Worker-runtime pure import;
- negative `/cms-import` and private deep-import probes;
- two identical serial candidate packs.

## 18. Documentation

Publish:

- data-source author guide;
- portable model and frontmatter reference;
- MDC portability and Studio-editability matrices;
- asset model and security policy;
- filesystem <-> CMS migration guide;
- `/cms-import` migration guide;
- Level-1 versus Level-2 evidence guide;
- local development tarball guide;
- public error and limit reference.

All examples compile against packed packages.

## 19. Completion Checklist

- [ ] published `0.2.1` baseline and combined `0.3.0` release scope are recorded;
- [ ] one resolved contract and hash exist;
- [ ] canonical JSON/hash vectors pass in Node, Worker V8, and Convex;
- [ ] data-source methods are fixed-type, bounded, and framework-free;
- [ ] cache/invalidation semantics survive the binder cutover;
- [ ] `PortableDocumentV1` and every file mapping are implemented;
- [ ] manifest deletion/rebuild is exact;
- [ ] identity survives every supported round trip;
- [ ] authored and derived facts are separated;
- [ ] portable and Studio-editable MDC matrices pass;
- [ ] assets use verified content-addressed blobs;
- [ ] Node directory safety and limits pass;
- [ ] Level-1 conformance makes no operational claims;
- [ ] CMS Level-2 evidence is recorded separately;
- [ ] `/cms-import` is removed with negative probes;
- [ ] development and candidate tarball lanes are separate;
- [ ] strict packed consumers pass without sibling resolution;
- [ ] two serial candidate packs are identical;
- [ ] no active item remains unchecked.

Do not publish, tag, push, or deploy during implementation.
