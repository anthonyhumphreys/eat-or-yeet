import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import schema from "../backend/schema";
import type { TableNames } from "../backend/model";
import { internal } from "../backend/api";
import { fetchMutation, fetchQuery } from "../backend/http-client";

const filename = process.argv[2];
if (!filename) throw new Error("Usage: pnpm backend:restore path/to/convex-export.zip [--validate-only | --sql-output path.sql]");
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
const ids = groups.flatMap(group => group.rows.map(row => row.id));
if (new Set(ids).size !== ids.length) throw new Error("Export contains duplicate record identifiers");
const sqlOutputIndex = process.argv.indexOf("--sql-output");
if (sqlOutputIndex !== -1) {
  const output = process.argv[sqlOutputIndex + 1];
  if (!output || output.startsWith("--")) throw new Error("--sql-output requires a destination file");
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  // Native D1 imports are much faster than individual restore requests during
  // the write freeze. Abort unless the destination is empty, preserving IDs.
  const statements = ["INSERT OR REPLACE INTO transaction_assertion(id,valid) VALUES(1,(SELECT COUNT(*)=0 FROM records));",
    "CREATE TABLE restore_payload_chunks(record_id TEXT, ordinal INTEGER, piece TEXT, PRIMARY KEY(record_id,ordinal));"];
  for (const { table, rows } of groups) for (const row of rows) {
    const payload = JSON.stringify(row.value);
    const statement = `INSERT INTO records(id,table_name,created_at,payload) VALUES(${literal(row.id)},${literal(table)},${row.createdAt},${literal(payload)});`;
    if (Buffer.byteLength(statement) <= 90_000) statements.push(statement);
    else {
      // Large original source archives fit a D1 row but exceed its 100 KB SQL
      // statement limit. Reassemble ordered chunks before JSON validation.
      // Chunk Unicode code points so a boundary never splits a surrogate pair.
      const characters = Array.from(payload);
      for (let offset = 0; offset < characters.length; offset += 10_000) statements.push(
        `INSERT INTO restore_payload_chunks VALUES(${literal(row.id)},${offset},${literal(characters.slice(offset, offset + 10_000).join(""))});`,
      );
      statements.push(`INSERT INTO records(id,table_name,created_at,payload) SELECT ${literal(row.id)},${literal(table)},${row.createdAt},group_concat(piece,'') FROM (SELECT piece FROM restore_payload_chunks WHERE record_id=${literal(row.id)} ORDER BY ordinal);`);
      statements.push(`DELETE FROM restore_payload_chunks WHERE record_id=${literal(row.id)};`);
    }
  }
  statements.push("DROP TABLE restore_payload_chunks;");
  statements.push("UPDATE transaction_state SET revision=revision+1 WHERE id=1;");
  writeFileSync(output, statements.join("\n"), { mode: 0o600, flag: "wx" });
  console.log("Saved validated SQL for an empty D1 destination.");
} else if (!process.argv.includes("--validate-only")) {
  await fetchQuery(internal.migration.preflight, { ids: groups.flatMap((group) => group.rows.map((row) => row.id)) }, { admin: true });
  for (const { table, rows } of groups) {
    for (let offset = 0; offset < rows.length; offset += 25) {
      await fetchMutation(internal.migration.restore, { table, rows: rows.slice(offset, offset + 25) }, { admin: true });
    }
    console.log(`Restored ${table}: ${rows.length} records.`);
  }
}
