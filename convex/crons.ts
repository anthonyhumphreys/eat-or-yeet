import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron("refresh official food warnings", "17 4 * * *", internal.incidents.refreshAllInternal);

export default crons;
