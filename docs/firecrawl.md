# Firecrawl sponsorship and FDA detail-page pilot

Firecrawl sponsors Eat or Yeet. The website acknowledges the sponsorship below the main navigation and in the footer, using unmodified wordmarks from [Firecrawl's brand assets](https://www.firecrawl.dev/press-brand). The sponsor link does not imply that Firecrawl publishes or verifies the warnings.

## Source boundaries

Provider APIs remain the primary feeds. FSA, openFDA food/drug enforcement and USDA FSIS retain their current retrieval, validation and reconciliation. FDA announcement discovery still reads the official listing and checks its reported totals for both food/beverages and dietary supplements.

The optional Firecrawl integration retrieves only FDA announcement **detail-page HTML**. It requests `rawHtml` through [`POST /v2/scrape`](https://docs.firecrawl.dev/agent-source-of-truth/curl), then passes that HTML through the existing deterministic parser. There is no generated JSON extraction, model-written recall advice, search-driven replacement feed, or change to product matching. Only canonical FDA announcement URLs are accepted; user-entered product details are never sent to Firecrawl.

The [Government Index](https://docs.firecrawl.dev/features/gov) is a separate US legal/regulatory search product. We have not established its recall coverage or timeliness, so it does not participate in imports or source-health checks.

## Evaluate without writing data

Set `FIRECRAWL_API_KEY` in your ignored `.env.local` or shell environment, then run:

```sh
pnpm data:evaluate:firecrawl --limit 3
```

Run this from a connection that can retrieve the FDA listing. The script reads the complete listing, takes the first three records, and compares the normalised detail-page output from direct retrieval and Firecrawl. Each selected page makes one paid Firecrawl request; the limit must be between 1 and 10. It reports the listing count, outcomes, differing field names and elapsed time. It never uploads snapshots, changes a source ledger or writes production data. A failed retrieval or any difference returns a nonzero exit code.

One matching page is a smoke test, not a complete coverage evaluation. Before enabling a full import, compare recent and older notices, multi-product tables, exact lot/GTIN/date associations, explicit terminations and previously blocked pages. Measure the complete run's duration and credits: a full import retrieves every detail page, including unchanged notices, and can be substantially more expensive than the sample.

## Enable explicitly

The default is `FDA_ANNOUNCEMENTS_DETAIL_FETCH_MODE=direct`, even when a Firecrawl key is present. To use Firecrawl, set the mode to `firecrawl` and provision `FIRECRAWL_API_KEY` in the runtime that performs the import. An unknown mode or missing required key fails before source retrieval. Keep credentials out of Vercel's public environment and committed files.

For the existing Docker importer, put the key in the ignored `deploy/fsis-sync/secrets/firecrawl-api-key` file using the same private-file permissions as the upload credentials, then opt in with:

```sh
docker compose -f deploy/fsis-sync/compose.yaml -f deploy/fsis-sync/compose.firecrawl.yaml up -d --build
```

The override mounts the key as a Docker secret. The base Compose file and production Worker configuration remain unchanged. FDA listing requests and USDA retrieval still require the existing working connection. Do not retire the external importer on the strength of this detail-page pilot.

To roll back, recreate the container using only the base Compose file. In other runtimes set the detail mode back to `direct`. No record IDs, schemas or database migration are involved.

## Failure and freshness behaviour

Firecrawl requests bypass its page cache with `maxAge: 0`. Both the API response and upstream status must succeed, source/final URLs must match the requested canonical notice, and the response must contain bounded raw HTML with the recall announcement section. Warnings, invalid responses and failed details fail the import; there is no silent transport fallback or paid request retry. A successful HTTP envelope alone never makes the source healthy.

Existing complete-list validation, source IDs, explicit-closure handling, durable import batches and the 48-hour freshness gate remain in force. The source ledger is updated by the existing importer only after its complete validated snapshot is processed. Firecrawl is not called while someone browses recalls or checks a pack.

For rollout, compare both retrieval methods over at least seven daily cycles without competing production writers. Enable one runtime deliberately only after unexplained differences are resolved and full-run costs and completion time fit its limits. Keep direct retrieval available for rollback.
