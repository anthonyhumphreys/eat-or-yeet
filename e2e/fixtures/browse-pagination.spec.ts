import { expect, test } from "@playwright/test";
const rows = (page: import("@playwright/test").Page) => page.locator("#warnings [data-recall-slug]");
test.beforeEach(async ({context,baseURL,page}) => {
  await context.addCookies([{name:"eat-or-yeet-region",value:"UK",url:baseURL!}]);
  page.on("pageerror",error=>{throw error;});
});

test("loads only the next page through the bounded API",async({page})=>{
  await page.goto("/?region=UK&q=fixture");
  await expect(rows(page)).toHaveCount(40);
  const next=page.waitForResponse(response=>response.url().includes("/api/warnings") && response.status()===200);
  await page.getByRole("link",{name:"Show 40 more"}).click();
  expect((await (await next).json()).rows).toHaveLength(40);
  await expect(rows(page)).toHaveCount(80);
  expect(await rows(page).evaluateAll(links=>new Set(links.map(link=>link.getAttribute("data-recall-slug"))).size)).toBe(80);
});

test("aborts obsolete filter requests and keeps the latest search",async({page})=>{
  await page.goto("/?region=UK");
  let release!:()=>void;
  let requested!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{requested=resolve;});
  await page.route("**/api/warnings?**",async route=>{
    if(new URL(route.request().url()).searchParams.get("q")==="fixture 9") {requested();await blocked;}
    try {await route.continue();} catch { /* The obsolete request may already be aborted. */ }
  });
  try {
    await page.getByRole("searchbox").fill("fixture 9");await started;
    await page.getByRole("searchbox").fill("fixture 12");
    await expect(rows(page)).toHaveCount(12);
    release();
    await expect(page.locator("#warnings")).toHaveAttribute("aria-busy","false");
    expect(await rows(page).allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Fixture recall 12")]));
    await expect(page.getByRole("searchbox")).toHaveValue("fixture 12");
  } finally {release();}
});

test("restarts pagination visibly when the dataset revision changes",async({page,request})=>{
  await page.goto("/?region=UK&q=fixture");
  await expect(rows(page)).toHaveCount(40);
  const rebuilt=await request.post("http://127.0.0.1:9161/rpc",{headers:{Authorization:"Bearer fixture-backend-secret"},data:{operation:"browse.rebuild",args:{}}});
  expect(rebuilt.ok()).toBe(true);
  await page.getByRole("link",{name:"Show 40 more"}).click();
  await expect(page.getByRole("status").filter({hasText:"The recall list changed"})).toBeVisible();
  await expect(rows(page)).toHaveCount(40);
  await expect(page).not.toHaveURL(/page=/);
});
