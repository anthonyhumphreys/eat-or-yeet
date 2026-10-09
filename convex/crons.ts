import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron("refresh official food warnings", "17 4 * * *", internal.incidents.refreshScheduledInternal);
crons.cron("clean expired temporary records", "17 5 * * *", internal.incidents.cleanupExpired);

export default crons;
