import nextEnv from "@next/env";
import { fetchMutation } from "../backend/http-client";
nextEnv.loadEnvConfig(process.cwd(), true);
const name = process.argv[2];
if (!name || !/^[a-zA-Z]+\.[a-zA-Z]+$/.test(name)) throw new Error("Usage: pnpm backend:run module.operation '{\"argument\":\"value\"}'");
const args: unknown = JSON.parse(process.argv[3] ?? "{}");
console.log(JSON.stringify(await fetchMutation({ name }, args, { admin: true })));
