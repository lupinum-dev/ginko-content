# Step 3: Query engine correctness

**Why:** The query engine returns wrong answers in common cases: numbers sort
as text, a `$not` on `locale` mixes locales, dotted projections are accepted and
ignored, and a page built from two documents gets only the last document's
ETag (so a stale page can validate). Existing tests pass while these bugs
reproduce, because no test covers them.

**Closes:** E-A006, E-A009, E-A010, E-A012, C-15, E-A019, E-A017, E-A018.

**Branch:** `step/03-query-correctness`. **Estimate:** ~4 h. All tasks are
pure functions in `src/core/`; test them in the `unit` or `contracts-node`
Vitest project.

## Tasks

### 3.1 Typed, multi-key sort (E-A006, C097) (~45 min)

**File:** `src/core/query/operators.ts` (sort function at ~line 95–125).

Today every value is turned into a string (`[-10,-2,10,100,2]`), and keys are
applied one after another with separate `sort()` calls, so the **last** key
wins instead of the first.

Decided behavior:

- One comparator over all keys in order; the first key is primary, later keys break ties.
- Per key, compare by type: both finite numbers → numeric; both `Date` or both
  ISO-8601 date strings that the schema declared as dates → time value; both
  booleans → `false < true`; otherwise the existing `Intl.Collator` string
  compare with `$numeric` / `$caseFirst` / `$sensitivity` options as today.
- Mixed types for one key: order by type rank `number < date < boolean < string`.
- `null` and `undefined` always sort **last**, in both directions.
- `-1` reverses the comparison for that key only (not the missing-value rule).
- The sort is stable: equal rows keep source order.

Table test (`test/unit/query-sort.test.ts`, literal arrays):

| Input values for `n`, sort `{ n: 1 }` | Expected order |
|---|---|
| `100, -2, 10, 2, -10` | `-10, -2, 2, 10, 100` |
| `3, null, 1, undefined` | `1, 3, null, undefined` (missing keep source order) |
| same, `{ n: -1 }` | `3, 1, null, undefined` |
| rows `{a:1,b:2},{a:1,b:1},{a:0,b:9}` sort `{ a: 1, b: 1 }` | `{a:0,b:9},{a:1,b:1},{a:1,b:2}` |

**Done when:** table test passes (fails before); demos C097 passes.

### 3.2 Default-locale scope ignores negated locale filters (E-A009, X101) (~30 min)

**File:** `src/core/query/params.ts` (~line 146).

`findQueryWhere(where, item => typeof item.locale !== 'undefined')` also finds
`locale` inside `$not` and `$or`, so `$not: { locale: 'de' }` turns off default
locale scoping and returns every other locale.

Decided rule: default-locale scoping is skipped only when the top-level `where`
list, or a top-level `$and`, contains a **positive** locale constraint
(`locale: 'x'`, `locale: { $eq: 'x' }`, `locale: { $in: [...] }`). A locale
inside `$not`, `$or` or `$ne`/`$nin` does not count.

Tests: `{ $not: { locale: 'de' } }` on an en/de collection returns only `en`
rows; `[{ locale: 'de' }, { $not: { locale: 'de' } }]` returns no rows;
`{ locale: { $in: ['en', 'de'] } }` returns both.

**Done when:** tests pass (first fails before); demos X101 passes.

### 3.3 Dotted projections work (E-A010, X202) (~45 min)

**File:** `src/core/query/operators.ts` (`projectDocumentFields`, `withKeys`,
`withoutKeys`).

Decided behavior:

- `only: ['author.name']` returns `{ author: { name } }` plus guaranteed keys.
- `only: ['author']` returns the whole `author` object.
- `without: ['author.email']` returns the document with only that nested key removed.
- A path segment that reaches an array applies the rest of the path to each
  element that is a plain object (`only: ['tags.label']` on
  `tags: [{label, id}]` → `tags: [{label}]`).
- A path that does not exist is ignored (no key created).
- `only` and `without` on the same path: `without` wins.
- Keep the existing `$`-prefix behavior for top-level keys.

Same rules for the provider wire: `src/features/query/query-plan-boundary.ts`
and the filesystem provider apply `projectDocumentFields`, so one change fixes
both. Verify with `rg "projectDocumentFields" packages/content/src`.

Table test (`test/unit/query-projection.test.ts`) with the rows above. The
first row fails before.

**Done when:** test passes; demos X202 passes.

### 3.4 Aggregate ETag covers every dependency (E-A012, X204) (~30 min)

**File:** `src/core/cache-hints.ts` (merge function, ~line 60–89).

`etag: right.etag || left.etag` keeps one ETag. Decided: the merged hint keeps
a list of distinct dependency ETags internally and exposes one value:

- one distinct ETag → that ETag unchanged;
- two or more → `W/"<ohash hash of the sorted distinct etags>"` (use `hash`
  from `ohash`, already a dependency);
- any dependency without an ETag → no ETag (cannot prove freshness).

Keep the internal list off the wire: compute the final value where the hint is
applied to the response (`src/runtime/server/cache-hints.ts`). Step 5 deletes
the binder's second, hashed aggregation in `public/provider-binder.ts`; leave a
`// replaced in step 5` note only if the binder still compiles against the old
shape.

Tests: merge `{etag:'"a"'}` + `{etag:'"b"'}` → weak hash, stable for swapped
order; `"a"` + `"a"` → `"a"`; `"a"` + no etag → none.

**Done when:** tests pass (first fails before); demos X204 passes.

### 3.5 Navigation `sort` is applied (C-15, C106) (~30 min)

Descending navigation sort returns ascending order. Trace
`runtime/server/navigation-query.ts` (`trustedNavigationPlan` passes
`sort = source.sort`) into `features/navigation/build.ts`, whose
`sortCanonicalTree` always re-sorts siblings by basename after the query. The
decided rule: when the caller passes `sort`, siblings keep the query order and
the basename sort is skipped; without `sort`, the natural basename order stays.

Test: navigation with `sort: { title: -1 }` returns sibling titles in
descending order. Fails before.

**Done when:** test passes; demos C106 passes.

### 3.6 One locale-prefix splitter (E-A019) (~20 min)

`src/core/content/path.ts:269` and `src/features/localization/path.ts:61`
both split a locale prefix. Keep the one in `core/content/path.ts`; make the
other call it; delete the duplicate. Existing tests must pass unchanged.

**Done when:** `rg -n "function .*[Ll]ocale[A-Za-z]*[Pp]refix" packages/content/src` shows one implementation; `pnpm test` passes.

### 3.7 Delete dead code (E-A017, E-A018) (~15 min)

- `src/module/virtual.ts:36`: remove the unused generated `getParser` and
  `getTransformers` virtual exports.
- `src/storage/graph.ts:99`: remove `resolveCanonicalKey` and
  `resolveRouteVariant`. If a test imports one, delete that test case (it tests
  dead code; this deletion is named here).

**Done when:** `rg "getParser|getTransformers|resolveCanonicalKey|resolveRouteVariant" packages/content/src test` is empty; `pnpm test` and `pnpm typecheck` pass.

### 3.8 Read-only results, confirmed live (E-A011, X203) (~15 min)

Step 1 (PR #89) made snapshot documents deeply frozen: mutating a query result
throws `TypeError`, and later reads are unchanged. The demo check X203 was
written before that decision and expects a mutable copy. Change X203 in
`ginko-content-demos/checks` to assert: mutating a returned document throws
`TypeError` **or** leaves the next read unchanged, and the next read is
unchanged. Update its rationale text in `checks/expectations.json`.

**Done when:** X203 passes against the blog demo built from this step.

## Step verification

```bash
pnpm verify
```

Demos: blog (C097, X202, X203, X204), multilingual (X101), docs-site (C106). Deploy
blog, multilingual, docs-site.

**Docs:** `5.reference/4.query-api.md`: sort rules (types, missing values
last, multi-key precedence), dotted projection rules, the locale scoping rule.
