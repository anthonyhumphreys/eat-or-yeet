import "server-only";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";

import { ProductObservationSchema, type ProductObservation } from "@/lib/domain/schemas";

const extractionPrompt = `You are a literal packaging transcription system for a food-safety application.

Extract only information visibly present in the supplied image. Never decide whether the food is safe or recalled.

Rules:
- Never invent missing values.
- Never infer a farm, producer, manufacturer, country, or supply-chain relationship from branding.
- Return null when a value cannot be read reliably.
- Preserve batch, lot, establishment, approval, egg, and date codes as printed.
- A barcode field must contain digits only when the full code is visible.
- rawVisibleText contains short verbatim text fragments that are actually visible.
- Structured fields may interpret labels, but must not add facts absent from the image.
- confidence is your confidence in the extraction as a whole, not a safety score.

Inspect the image and return the structured observation.`;

export async function extractProductObservation(file: File): Promise<ProductObservation> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Photo analysis is not configured");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const openrouter = createOpenRouter({
    apiKey,
    headers: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Eat or Yeet",
    },
  });
  const { output } = await generateText({
    model: openrouter.chat(process.env.OPENROUTER_MODEL ?? "z-ai/glm-5.3-flash"),
    output: Output.object({ schema: ProductObservationSchema }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: extractionPrompt },
          { type: "file", mediaType: file.type || "image/jpeg", data: bytes },
        ],
      },
    ],
  });
  return ProductObservationSchema.parse(output);
}
