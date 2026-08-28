import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";

if (process.env.ALLOW_DEMO_DATA !== "true") throw new Error("Set ALLOW_DEMO_DATA=true to seed fictional examples");
if (!process.env.NEXT_PUBLIC_CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
if (!process.env.CONVEX_SERVER_SECRET) throw new Error("CONVEX_SERVER_SECRET is required");

const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
const count = await client.mutation(api.seed.demo, { secret: process.env.CONVEX_SERVER_SECRET });
console.log(`Seeded ${count} clearly marked demo incidents.`);
