import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../backend/api";
import { createBackend } from "./backend-harness";
const row = { id: "legacy-product-id", createdAt: 17, value: { gtin: "05000000000005", name: "Historical product", metadata: {}, updatedAt: 18 } };
beforeEach(() => { vi.stubEnv("BACKEND_RESTORE_ENABLED", "true"); });
afterEach(() => { vi.unstubAllEnvs(); });
describe("D1 snapshot restore", () => {
  it("preserves opaque IDs and timestamps and safely resumes the same export", async () => {
    const t = createBackend();
    await t.mutation(internal.migration.restore, { table: "products", rows: [row] });
    await t.query(internal.migration.preflight, { ids: [row.id] });
    await t.mutation(internal.migration.restore, { table: "products", rows: [row] });
    const saved = await t.run((ctx) => ctx.db.query("products").collect());
    expect(saved).toEqual([{ ...row.value, _id: row.id, _creationTime: 17 }]);
  });
  it("rejects another dataset and refuses an identifier already belonging to another table", async () => {
    const t = createBackend();
    await t.mutation(internal.migration.restore, { table: "products", rows: [row] });
    await expect(t.query(internal.migration.preflight, { ids: ["other-export"] })).rejects.toThrow("outside this export");
    await expect(t.mutation(internal.migration.restore, { table: "rateLimits", rows: [{ ...row, value: { key: "a", subjectHash: "b", action: "check", count: 1, windowStartedAt: 0, expiresAt: 100 } }] })).rejects.toThrow("another table");
    expect(await t.run((ctx) => ctx.db.query("products").collect())).toHaveLength(1);
  });
  it("does not commit earlier rows in a batch with an invalid record", async () => {
    const t = createBackend();
    await expect(t.mutation(internal.migration.restore, { table: "products", rows: [row, { ...row, id: "invalid", value: {} }] })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("products").collect())).toEqual([]);
  });
});
