import { createServer } from "node:http";
import { BackendError } from "../../backend/values";
import { createBackend } from "../../tests/backend-harness";

const backend = createBackend();
await backend.run(async (ctx) => {
  for (const region of ["UK", "US"] as const) {
    for (let index = 0; index < 130; index++) {
      const medical = region === "US" && index >= 110;
      const record = {
        title: region === "UK" ? `Fixture recall ${index}` : medical ? `Fixture medicine recall ${index}` : `Fixture chocolate recall ${index}`,
        slug: `${region === "UK" ? "fixture" : "us-fixture"}-${index}`, region,
        status: medical ? "reported" as const : "active" as const,
        startsAt: 0, isDemo: false,
        hazard: medical ? "Subpotent drug" : "Undeclared milk, egg and sesame allergens",
        summary: "Fixture warning",
        consumerAdvice: medical ? "Do not stop taking a prescribed medicine without medical advice. Ask a pharmacist." : "Return the affected fixture product.",
        authority: medical ? "U.S. Food and Drug Administration" : "Food Standards Agency",
        authorityUrl: medical ? "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" : "https://alerts.food.gov.uk/",
        sourceId: `FSA-PRIN-${index}-2026`,
        publishedAt: Date.now() - 1000, updatedAt: Date.now() - index * 1000, severity: "medium" as const, confidence: 1, targets: [],
      };
      const incidentId = await ctx.db.insert("incidents", { ...record, retrievedAt: Date.now(), originalSourceData: {} });
      await ctx.db.insert("incidentMatchData", { ...record, incidentId,
        categories: medical ? ["Over-the-counter medicines"] : ["Snacks & sweets"],
        superCategories: medical ? ["Medical"] : ["Food"], stores: ["Waitrose"] });
    }
  }
});

createServer(async (request, response) => {
  if (request.url === "/health") { response.end("ok"); return; }
  if (request.headers.authorization !== "Bearer fixture-backend-secret") { response.writeHead(401); response.end(); return; }
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { operation, args } = JSON.parse(body);
    const result = await backend.query({ name: operation }, args);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ result }));
  } catch (error) { response.writeHead(error instanceof BackendError ? 409 : 500); response.end(JSON.stringify({ error: error instanceof BackendError ? error.data : "Fixture operation failed" })); }
}).listen(Number(process.env.FIXTURE_BACKEND_PORT ?? 9161), "127.0.0.1");
