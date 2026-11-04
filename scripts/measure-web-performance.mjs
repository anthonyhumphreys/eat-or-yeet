import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run against a production build. Cold browser contexts, warm server cache, three samples per route.
const baseURL = process.env.PERF_BASE_URL ?? 'http://localhost:3100';
const output = process.argv[2] ?? 'out/web-performance.json';
const runs = Number(process.env.PERF_RUNS ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('PERF_RUNS must be between 1 and 10');
await mkdir(path.dirname(output), {recursive:true});
const browser = await chromium.launch();
const results = [];
const routes = process.env.PERF_ROUTES?.split(',') ?? ['/?region=UK', '/?region=US', '/incidents?region=US', '/search', ...(process.env.PERF_DETAIL_PATH ? [process.env.PERF_DETAIL_PATH] : [])];
try {
  for (const route of routes) {
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'light' });
      await context.addCookies([{name:'eat-or-yeet-region',value:'UK',url:baseURL},{name:'eat-or-yeet-analytics',value:'v1.declined',url:baseURL}]);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', {rate:4});
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {offline:false,latency:80,downloadThroughput:200000,uploadThroughput:93750});
      await page.addInitScript(() => {
        window.lab = {lcp:0,cls:0,longTasks:0};
        new PerformanceObserver(list=>{for(const e of list.getEntries()) window.lab.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});
        new PerformanceObserver(list=>{for(const e of list.getEntries()) if(!e.hadRecentInput) window.lab.cls+=e.value}).observe({type:'layout-shift',buffered:true});
        new PerformanceObserver(list=>{for(const e of list.getEntries()) window.lab.longTasks+=Math.max(0,e.duration-50)}).observe({type:'longtask',buffered:true});
      });
      await page.goto(baseURL+route, {timeout:90000,waitUntil:'domcontentloaded'});
      if(route.startsWith('/?') || route.startsWith('/incidents?')) await page.getByRole('heading',{name:/recalls in the/}).waitFor();
      await page.getByRole('heading',{level:1}).waitFor();
      // Fixed observation window for the late streaming content, not application synchronization.
      await page.waitForTimeout(1500);
      const metrics = await page.evaluate(() => ({...window.lab, documentBytes:performance.getEntriesByType('navigation')[0].encodedBodySize, documentTransfer:performance.getEntriesByType('navigation')[0].transferSize, fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime, ttfb:performance.getEntriesByType('navigation')[0].responseStart, resources:performance.getEntriesByType('resource').map(e=>({name:e.name,bytes:e.encodedBodySize,transfer:e.transferSize,type:e.initiatorType})), rows:document.querySelectorAll('#warnings ul li').length}));
      if ((route.startsWith('/?') || route.startsWith('/incidents?')) && await page.getByRole('searchbox').count()) {
        const start=performance.now();
        await page.getByRole('searchbox').fill('milk');
        await page.getByRole('heading',{name:/recalls? found/}).waitFor();
        metrics.filterMs=performance.now()-start;
      }
      const scripts=metrics.resources.filter(e=>e.name.includes('/_next/')&&e.name.includes('.js'));
      metrics.scriptBytes=scripts.reduce((sum,e)=>sum+e.bytes,0);
      metrics.scriptRequests=scripts.length;
      metrics.prefetchRequests=metrics.resources.filter(e=>e.name.includes('_rsc=')).length;
      results.push({route,run,...metrics});
      await writeFile(output, JSON.stringify(results,null,2));
      console.log(route,run,Math.round(metrics.lcp),metrics.scriptBytes);
      await context.close();
    }
  }
} finally { await browser.close(); }
await writeFile(output, JSON.stringify(results,null,2));
console.log(`Saved ${results.length} lab samples to ${output}`);
