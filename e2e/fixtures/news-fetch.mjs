// Used only by the isolated Playwright server; no external publisher requests.
const original = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/bbc(?:i)?\.co\.uk|cbsnews\.com|theguardian\.com/.test(url)) {
    return new Response("<rss><channel><title>Fixture news</title></channel></rss>", { headers: { "Content-Type": "application/xml" } });
  }
  return original(input, init);
};
