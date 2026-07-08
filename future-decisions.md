# Future Decisions (deferred, post-0.2.0 candidates)

- Full fluent + query IR cutover: retire the string-operator fluent API (`ContentQueryBuilder`/`createQuery`, the `CollectionQueryOperator` string operators) and the internal params IR (`ContentQueryBuilderParams`/`ContentQueryBuilderWhere`) so `ContentQueryPlan` / `ContentProviderQuery` become the only query vocabulary end to end. Deferred from Phase 3 T3.3 (2026-07-08 third ruling) — it is a large, breaking, ADR-0016-touching change, not part of the "privatize the transport vocabulary" scope.
