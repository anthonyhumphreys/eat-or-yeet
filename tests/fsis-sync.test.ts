import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: execMock }) };
});

import { FSIS_API } from "@/lib/incidents/fsis";
import { syncFsis } from "../scripts/lib/fsis-sync";

const record = {
  field_title: "Test recall", field_recall_number: "001-2026", field_recall_number_export: "001-2026",
  field_recall_url: "https://www.fsis.usda.gov/recalls-alerts/test-recall",
  field_recall_date: "2026-10-01", field_active_notice: "TRUE", field_summary: "Do not eat this food.", langcode: "English",
};
const success = { status: "success", found: 1, created: 0, updated: 1, errors: [] };

describe("USDA fetcher transport", () => {
  beforeEach(() => {
    execMock.mockReset();
    execMock.mockImplementation(async (_node, args: string[]) => ({ stdout: JSON.stringify(
      args.includes("incidents:createFsisSnapshotUpload") ? "https://example.test/upload"
        : args.includes("incidents:importFsisSnapshotInternal") ? success : null,
    ) }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === FSIS_API
      ? Response.json([record, { ...record, langcode: "Spanish" }]) : Response.json({ storageId: "test-storage-id" })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("validates the complete archive before uploading only English records, then awaits import", async () => {
    const env = { NODE_ENV: "test" as const, CONVEX_DEPLOY_KEY: "test-only-key" };
    await expect(syncFsis({ prod: true, env })).resolves.toEqual(success);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe(FSIS_API);
    expect(calls[1][0]).toBe("https://example.test/upload");
    expect(JSON.parse(calls[1][1]!.body as string)).toMatchObject([record]);
    expect(execMock.mock.calls.every((call) => call[1].includes("--prod") && call[2].env === env)).toBe(true);
    const args = execMock.mock.calls[1][1] as string[];
    expect(JSON.parse(args.at(-1)!)).toEqual({ storageId: "test-storage-id", fetchedAt: expect.any(Number) });
  });

  it("does not create an upload URL or write data when USDA returns malformed records", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json([record, { ...record, field_recall_url: "https://example.test/fake", langcode: "English" }]));
    await expect(syncFsis()).rejects.toThrow("outside fsis.usda.gov");
    expect(execMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected upload without calling the importer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([record])).mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(syncFsis()).rejects.toThrow("HTTP 500");
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "partial"])("cleans up and reports failure when the import result is %s", async (status) => {
    execMock.mockImplementation(async (_node, args: string[]) => ({ stdout: JSON.stringify(
      args.includes("incidents:createFsisSnapshotUpload") ? "https://example.test/upload"
        : args.includes("incidents:importFsisSnapshotInternal") ? { ...success, status } : null,
    ) }));
    await expect(syncFsis()).rejects.toThrow("did not complete successfully");
    expect(execMock.mock.calls[2][1]).toContain("incidents:deleteFsisSnapshot");
  });

  it("cleans up after a lost importer request and keeps sensitive CLI errors out of logs", async () => {
    execMock.mockImplementation(async (_node, args: string[]) => {
      if (args.includes("incidents:createFsisSnapshotUpload")) return { stdout: JSON.stringify("https://example.test/upload") };
      throw new Error("secret deployment key and upload URL should never appear");
    });
    await expect(syncFsis()).rejects.toThrow(/^Convex function incidents:importFsisSnapshotInternal failed; check deployment access and the ingestion ledger$/);
    expect(execMock.mock.calls[2][1]).toContain("incidents:deleteFsisSnapshot");
  });
});
