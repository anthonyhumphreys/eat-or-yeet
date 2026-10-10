import { describe, expect, it } from "vitest";

import { parseFdaAnnouncementDetail, parseFdaAnnouncementRows } from "@/lib/incidents/fda-announcements";
import { browseCategories } from "@/lib/incidents/categories";
import gripeWaterRow from "./fixtures/fda-gripe-water.json";

const listingRow = [
  '<time datetime="2026-08-22T04:00:00Z">08/22/2026</time>',
  '<a href="/safety/recalls-market-withdrawals-safety-alerts/everything-sprouts-recall">Everything Sprouts, Calco</a>',
  "Alfalfa Sprouts",
  "Food &amp; Beverages, Foodborne Illness",
  "Potential contamination with Salmonella and E. coli",
  "Everything Sprouts, LLC",
  "",
  "",
];

describe("FDA recall announcements", () => {
  it("imports the dietary-supplement gripe-water notice with its affected lot and advice", () => {
    const rows = parseFdaAnnouncementRows({ data: [gripeWaterRow] });
    expect(rows).toHaveLength(1);
    const incident = parseFdaAnnouncementDetail(rows[0], `
      <h2 id="recall-announcement">Company Announcement</h2>
      <p>Pacific Health Sciences is recalling Baby Sleep Gripe Water.</p>
      <p>Lot Number: 25122bw</p>
      <p>Best Before: 12/2028</p>
      <p>Consumers should stop using the affected lot and discard it or return it.</p>
      <h2>Company Contact Information</h2>
    `);

    expect(incident).toMatchObject({ region: "US", status: "active", hazard: gripeWaterRow[4] });
    expect(incident.targets).toContainEqual(expect.objectContaining({ type: "lot", value: "25122BW" }));
    expect(incident.consumerAdvice).toContain("stop using");
    expect(browseCategories(incident)).toEqual(["Supplements"]);
  });

  it("keeps unrelated FDA product types out of the food and supplement import", () => {
    const rows = ["Drugs", "Medical Devices", "Cosmetics", "Animal &amp; Veterinary"].map((productType) => {
      const row = [...listingRow];
      row[3] = productType;
      return row;
    });
    expect(parseFdaAnnouncementRows({ data: rows })).toEqual([]);
  });

  it("parses the official listing row", () => {
    const rows = parseFdaAnnouncementRows({ data: [listingRow] });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      brand: "Everything Sprouts, Calco",
      company: "Everything Sprouts, LLC",
      product: "Alfalfa Sprouts",
      terminated: false,
    });
  });

  it("extracts exact GTIN and lot targets from the official announcement", () => {
    const [listing] = parseFdaAnnouncementRows({ data: [listingRow] });
    const incident = parseFdaAnnouncementDetail(listing, `
      <h2 id="recall-announcement">Company Announcement</h2>
      <p>The recalled packages bear the following bar codes: 860014523113, 860014523120 and 850079470149.</p>
      <p>Affected packages have lot numbers: LOT #222, 223, 225, 226, 230.</p>
      <p>Consumers should immediately dispose of affected sprouts and clean any surfaces they touched.</p>
      <h2>Company Contact Information</h2>
    `);

    expect(incident.status).toBe("active");
    expect(incident.pathogen).toBe("Salmonella");
    expect(incident.consumerAdvice).toContain("immediately dispose");
    expect(incident.targets.filter((target) => target.type === "gtin").map((target) => target.value)).toEqual([
      "860014523113",
      "860014523120",
      "850079470149",
    ]);
    expect(incident.targets.filter((target) => target.type === "lot").map((target) => target.value)).toEqual([
      "222",
      "223",
      "225",
      "226",
      "230",
    ]);
  });

  it("accepts a valid 14-digit GTIN from an FDA UPC label", () => {
    const [listing] = parseFdaAnnouncementRows({ data: [[
      '<time datetime="2026-08-29T04:00:00Z">08/29/2026</time>',
      '<a href="/safety/recalls-market-withdrawals-safety-alerts/panorama-produce-recalls-mangoes">Martina</a>',
      "Mangoes",
      "Food &amp; Beverages, Foodborne Illness",
      "Potential contamination with Salmonella",
      "Panorama Produce",
      "",
      "",
    ]] });
    const incident = parseFdaAnnouncementDetail(listing, `
      <h2 id="recall-announcement">Company Announcement</h2>
      <p>The mangoes have PLU 4584 and UPC # 07503061948050.</p>
      <p>Consumers should dispose of them or return them to the place of purchase.</p>
      <h2>Company Contact Information</h2>
    `);

    expect(incident.targets).toContainEqual(expect.objectContaining({ type: "gtin", value: "07503061948050" }));
  });
});
