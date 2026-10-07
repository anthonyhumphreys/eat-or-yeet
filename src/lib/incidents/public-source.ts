type OfficialSource = { authorityUrl: string; sourceId: string; authority: string };

export function publicOfficialSource(incident: OfficialSource): { url: string; label: string; note?: string } {
  let url: URL | undefined;
  try { url = new URL(incident.authorityUrl); } catch { /* Use the authority's public index below. */ }

  if (incident.authority === "Food Standards Agency") {
    if (url?.hostname === "alerts.food.gov.uk" && url.protocol === "https:") return { url: url.href, label: "Official source" };
    const notation = /^FSA-(?:AA|PRIN|FAFA)-\d+-\d{4}(?:-UPDATE-\d+)?$/i.test(incident.sourceId) ? incident.sourceId : null;
    return {
      url: notation ? `https://alerts.food.gov.uk/news-alerts/alert/${notation.toUpperCase()}` : "https://alerts.food.gov.uk/",
      label: notation ? "Official source" : "FSA public alerts",
    };
  }

  if (incident.authority === "U.S. Food and Drug Administration") {
    if (url?.hostname === "www.fda.gov" && url.protocol === "https:" && url.pathname.startsWith("/safety/recalls-market-withdrawals-safety-alerts/")) return { url: url.href, label: "Official source" };
    return {
      url: "https://www.accessdata.fda.gov/scripts/ires/index.cfm#/search/",
      label: "FDA public enforcement report",
      note: `Search the report for source ID ${incident.sourceId}. Some enforcement records have no separate public announcement.`,
    };
  }

  if (url?.protocol === "https:" && url.hostname === "www.fsis.usda.gov") return { url: url.href, label: "Official source" };
  return { url: "https://www.fsis.usda.gov/recalls", label: "USDA public recalls" };
}
