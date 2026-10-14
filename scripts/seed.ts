import { fetchMutation } from "../backend/http-client";
import { api } from "../backend/api";

if (process.env.ALLOW_DEMO_DATA !== "true") throw new Error("Set ALLOW_DEMO_DATA=true to seed fictional examples");
if (!process.env.BACKEND_SECRET) throw new Error("BACKEND_SECRET is required");
const count = await fetchMutation(api.seed.demo, { secret: process.env.BACKEND_SECRET }, { admin: true });
console.log(`Seeded ${count} clearly marked demo incidents.`);
