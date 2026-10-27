import { createServer } from "node:http";
import { BackendError } from "../../backend/values";
import { createBackend } from "../../tests/backend-harness";

const backend = createBackend();
await backend.run(async (ctx) => {
  for (let index = 0; index < 130; index++) {
    const record = {
      title: `Fixture recall ${index}`, slug: `fixture-${index}`, region: "UK" as const, status: "active" as const,
      startsAt: 0, isDemo: false, hazard: "Undeclared milk, egg and sesame allergens",
      summary: "Fixture warning", consumerAdvice: "Return the affected fixture product.",
      authority: "Food Standards Agency", authorityUrl: "https://alerts.food.gov.uk/", sourceId: `FSA-PRIN-${index}-2026`,
      publishedAt: Date.now() - 1000, updatedAt: Date.now() - index * 1000, severity: "medium" as const, confidence: 1, targets: [],
    };
    const incidentId = await ctx.db.insert("incidents", { ...record, retrievedAt: Date.now(), originalSourceData: {} });
    await ctx.db.insert("incidentMatchData", { ...record, incidentId, categories: ["Snacks & sweets"], superCategories: ["Food"], stores: ["Waitrose"] });
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
}).listen(9161, "127.0.0.1");
