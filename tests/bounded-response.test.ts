import { describe, expect, it } from "vitest";

import { readResponseJson, readResponseText, ResponseTooLargeError } from "@/lib/http/bounded-response";

describe("bounded response readers", () => {
  it("rejects a declared oversized response before reading the body", async () => {
    let pulled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode("large"));
      },
    }, { highWaterMark: 0 }), { headers: { "content-length": "5" } });

    await expect(readResponseText(response, 4)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(pulled).toBe(false);
  });

  it("stops a chunked response as soon as it passes the byte cap", async () => {
    let cancelled = false;
    const chunks = ["abc", "de"].map((value) => new TextEncoder().encode(value));
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }));

    await expect(readResponseText(response, 4)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(cancelled).toBe(true);
  });

  it("reads a legitimate JSON fixture within the cap", async () => {
    const fixture = { records: [{ id: "fsa-aa-01", title: "Allergy alert" }] };
    const response = Response.json(fixture, { headers: { "content-length": String(new TextEncoder().encode(JSON.stringify(fixture)).byteLength) } });

    await expect(readResponseJson(response, 2_048)).resolves.toEqual(fixture);
  });

  it("rejects invalid UTF-8 rather than replacing bytes", async () => {
    const response = new Response(new Uint8Array([0xc3, 0x28]));
    await expect(readResponseText(response, 20)).rejects.toThrow();
  });
});
