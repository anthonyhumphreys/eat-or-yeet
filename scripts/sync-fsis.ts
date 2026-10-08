import { syncFsis } from "./lib/fsis-sync";

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--prod")) {
  throw new Error("Usage: pnpm data:sync:fsis [--prod]");
}

console.log(JSON.stringify(await syncFsis({ prod: args[0] === "--prod" })));
