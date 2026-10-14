import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FSIS_API } from "@/lib/incidents/fsis";
import { syncFsis } from "../scripts/lib/fsis-sync";
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => undefined) }));

const record = {
  field_title: "Test recall", field_recall_number: "001-2026", field_recall_number_export: "001-2026",
  field_recall_url: "https://www.fsis.usda.gov/recalls-alerts/test-recall",
  field_recall_date: "2026-10-01", field_active_notice: "TRUE", field_summary: "Do not eat this food.", langcode: "English",
};
const success = { status: "success", found: 1, created: 0, updated: 1, errors: [] };

describe("USDA fetcher transport", () => {
  const env = { NODE_ENV: "test" as const, BACKEND_URL: "https://backend.example.test", FSIS_UPLOAD_TOKEN: "a".repeat(64), BACKEND_ENV: "production" };
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => String(url) === FSIS_API
      ? Response.json([record, { ...record, langcode: "Spanish" }]) : Response.json({ result: success })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("validates the archive before uploading only English records and waits for import", async () => {
    await expect(syncFsis({ prod: true, env })).resolves.toEqual(success);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe(FSIS_API);
    expect(String(calls[1][0])).toBe("https://backend.example.test/admin/fsis");
    expect(JSON.parse(calls[1][1]!.body as string)).toMatchObject({ fetchedAt: expect.any(Number), payload: [record] });
    expect(calls[1][1]?.headers).toMatchObject({ Authorization: `Bearer ${env.FSIS_UPLOAD_TOKEN}` });
  });

  it("does not upload malformed USDA records", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json([record, { ...record, field_recall_url: "https://example.test/fake", langcode: "English" }]));
    await expect(syncFsis({ env })).rejects.toThrow("outside fsis.usda.gov");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected upload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([record])).mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(syncFsis({ env })).rejects.toThrow("HTTP 500");
  });
  it("polls a queued import until its committed ledger reports success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([record]))
      .mockResolvedValueOnce(Response.json({ result: { ...success, status: "queued", runId: "ingestionRuns:one" } }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ result: { ...success, status: "running", runId: "ingestionRuns:one" } }))
      .mockResolvedValueOnce(Response.json({ result: { ...success, runId: "ingestionRuns:one" } }));
    await expect(syncFsis({ prod: true, env })).resolves.toMatchObject(success);
    expect(String(vi.mocked(fetch).mock.calls[2][0])).toBe("https://backend.example.test/admin/fsis?runId=ingestionRuns%3Aone");
  });
  it("recovers from transient polling failures without resubmitting or exposing credentials", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([record]))
      .mockResolvedValueOnce(Response.json({ result: { ...success, status: "queued", runId: "ingestionRuns:one" } }, { status: 202 }))
      .mockRejectedValueOnce(new Error("secret token must not appear"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ result: { ...success, runId: "ingestionRuns:one" } }));
    await expect(syncFsis({ prod: true, env })).resolves.toMatchObject(success);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each(["failed", "partial"])("reports a %s import", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([record])).mockResolvedValueOnce(Response.json({ result: { ...success, status } }));
    await expect(syncFsis({ env })).rejects.toThrow("did not complete successfully");
  });

  it("keeps transport errors containing credentials out of unattended logs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([record])).mockRejectedValueOnce(new Error("secret token must not appear"));
    await expect(syncFsis({ env })).rejects.toThrow(/^USDA upload request failed; check backend access and the ingestion ledger$/);
  });
});
