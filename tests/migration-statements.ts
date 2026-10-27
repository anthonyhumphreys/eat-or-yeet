import { readFileSync, readdirSync } from "node:fs";

export function migrationStatements() {
  const directory = new URL("../backend/migrations/", import.meta.url);
  return readdirSync(directory).filter(file => file.endsWith(".sql")).sort().flatMap(file => {
    const sql = readFileSync(new URL(file, directory), "utf8");
    return sql.split(sql.includes("-- statement-breakpoint") ? "-- statement-breakpoint" : ";\n").filter(statement => statement.trim());
  });
}
