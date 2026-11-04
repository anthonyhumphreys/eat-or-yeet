import { z } from "zod";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import type { SqlDatabase } from "../database";
import type { Doc } from "../model";
import { productCategories, rowSuperCategories, superCategories } from "../../src/lib/incidents/browse";
import { classifyHazard, hazardKinds } from "../../src/lib/incidents/hazard";
import { sourceHazardText, warningSearchText } from "../../src/lib/incidents/warning-search";

export const browseRowSchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), updatedAt: z.number(), summary: z.string(),
  categories: z.array(z.enum(productCategories)), superCategories: z.array(z.enum(superCategories)), stores: z.array(z.string()),
  hazard: z.object({ kind: z.enum(hazardKinds), label: z.string() }),
});
export type BrowseRow = z.infer<typeof browseRowSchema>;

export function browseContent(row: Pick<Doc<"incidentMatchData">, "title" | "hazard" | "pathogen" | "summary" | "targets" | "categories" | "stores" | "superCategories">, originalSourceData?: unknown) {
  const hazardText = sourceHazardText(originalSourceData, row.hazard);
  const browseHazard = classifyHazard({ ...row, hazard: hazardText });
  return { browseHazard, browseSearchText: warningSearchText({ ...row, hazard: browseHazard, hazardText }) };
}

export function browseStatements(sql: SqlDatabase, row: Doc<"incidentMatchData">, content: ReturnType<typeof browseContent>): D1PreparedStatement[] {
  const types = rowSuperCategories(row);
  const data: BrowseRow = { id: row.incidentId, slug: row.slug, title: row.title, updatedAt: row.updatedAt, summary: row.summary,
    categories: row.categories, superCategories: [...types], stores: row.stores, hazard: content.browseHazard };
  const facets = [...types.map(value => ({ facet: "type", value })), ...row.categories.map(value => ({ facet: "category", value })), ...row.stores.map(value => ({ facet: "store", value }))];
  return [
    sql.prepare(`INSERT INTO warning_browse(id,incident_id,region,status,is_demo,starts_at,ends_at,updated_at,hazard_kind,search_text,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET incident_id=excluded.incident_id,region=excluded.region,status=excluded.status,is_demo=excluded.is_demo,starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=excluded.updated_at,hazard_kind=excluded.hazard_kind,search_text=excluded.search_text,data=excluded.data`)
      .bind(row._id,row.incidentId,row.region,row.status,Number(row.isDemo),row.startsAt,row.endsAt ?? null,row.updatedAt,content.browseHazard.kind,content.browseSearchText,JSON.stringify(data)),
    sql.prepare("DELETE FROM warning_browse_facets WHERE browse_id=?").bind(row._id),
    sql.prepare("INSERT OR IGNORE INTO warning_browse_facets(browse_id,facet,value) SELECT ?,json_extract(value,'$.facet'),json_extract(value,'$.value') FROM json_each(?)").bind(row._id,JSON.stringify(facets)),
    sql.prepare("DELETE FROM warning_browse_dirty WHERE id=?").bind(row._id),
  ];
}
