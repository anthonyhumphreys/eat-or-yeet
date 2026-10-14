import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import schema from "../backend/schema";
import type { TableNames } from "../backend/model";
import { internal } from "../backend/api";
import { fetchMutation, fetchQuery } from "../backend/http-client";

const filename = process.argv[2];
if (!filename) throw new Error("Usage: pnpm backend:restore path/to/convex-export.zip [--validate-only]");
const archive = unzipSync(new Uint8Array(readFileSync(filename)));
const tables = Object.keys(schema) as TableNames[];
for (const name of Object.keys(archive).filter((name) => name.endsWith("/documents.jsonl"))) {
  const table = name.split("/")[0];
  if (table === "_tables") continue;
  if (table === "_storage" && !strFromU8(archive[name]).trim()) continue;
  if (!tables.includes(table as TableNames)) throw new Error(`Export contains unsupported records in ${table}`);
}
const groups = tables.map((table) => {
  const contents = archive[`${table}/documents.jsonl`];
  if (!contents) throw new Error(`The export is missing ${table}`);
  const rows = strFromU8(contents).split("\n").filter(Boolean).map((line) => {
    const record = z.record(z.string(), z.unknown()).parse(JSON.parse(line));
    const { _id, _creationTime, ...value } = record;
    return { id: z.string().parse(_id), createdAt: z.number().nonnegative().parse(_creationTime), value: schema[table].validator.parse(value) };
  });
  return { table, rows };
});
// Validate every table before the first write. The restore flag is off by
// default, and these calls require the separate operator credential.
console.log(`Validated ${groups.reduce((sum, group) => sum + group.rows.length, 0)} records across ${groups.length} tables.`);
if (!process.argv.includes("--validate-only")) {
  await fetchQuery(internal.migration.preflight, { ids: groups.flatMap((group) => group.rows.map((row) => row.id)) }, { admin: true });
  for (const { table, rows } of groups) {
    for (let offset = 0; offset < rows.length; offset += 25) {
      await fetchMutation(internal.migration.restore, { table, rows: rows.slice(offset, offset + 25) }, { admin: true });
    }
    console.log(`Restored ${table}: ${rows.length} records.`);
  }
}
