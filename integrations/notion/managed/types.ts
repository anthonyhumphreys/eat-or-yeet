import type { ShoppingWorkerConfig } from "../shopping-worker.ts";

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
export type Installation = {
  id: string;
  ownerId: string;
  workspaceId: string;
  botId: string;
  templatePageId?: string;
  region: Region;
  status: InstallationStatus;
  generation: number;
  binding?: ListBinding;
  createdAt: number;
  updatedAt: number;
  errorCode?: "missing_template" | "invalid_template" | "access_revoked" | "temporarily_unavailable";
};
export type OAuthPending = { region: Region; installationId?: string; expiresAt: number };
export type ManagementSession = { installationId: string; csrfToken: string; expiresAt: number };
export type ManagedConfig = {
  enabled: boolean;
  publicOrigin: string;
  websiteOrigin: string;
  listenHost: string;
  listenPort: number;
  stateDirectory: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  webhookVerificationToken: string;
  notionIntegrationId: string;
  notionSubscriptionId: string;
  reviewMcpUrl: string;
  reviewConnectionKey: string;
  maxInstallations: number;
  dailyReviewsPerInstallation: number;
  dailyReviewsGlobal: number;
};
