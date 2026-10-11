import type { ShoppingWorkerConfig } from "../shopping-core.ts";

export type Region = "UK" | "US";
export type InstallationStatus = "setting_up" | "active" | "paused" | "needs_reconnect" | "setup_failed" | "disconnecting";
export type Credentials = { accessToken: string; refreshToken: string };
export type Authorization = Credentials & { ownerId: string; workspaceId: string; botId: string; templatePageId?: string };
export type ListBinding = {
  templatePageId: string;
  databaseId: string;
  dataSourceId: string;
  properties: ShoppingWorkerConfig["notionProperties"];
  statusLabels: ShoppingWorkerConfig["statusLabels"];
};
