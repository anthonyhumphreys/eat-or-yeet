import type { Metadata } from "next";
import Link from "next/link";

import { NotionManagementActions } from "@/components/notion-management-form";
import { getNotionSetupOrigin } from "@/lib/integrations/notion-installation";
import { getNotionDisconnectReceipt, getNotionManagement } from "@/lib/integrations/notion-hosted";
import { regionNames } from "@/lib/location";

export const metadata: Metadata = {
  title: "Manage your Notion list",
  description: "Check or change the Eat or Yeet connection to your Notion shopping list.",
};

const statusLabels = {
  setting_up: "Setting up your list",
  active: "Reviews active",
  paused: "Reviews paused",
  needs_reconnect: "Reconnect your Notion account",
  setup_failed: "Your list needs attention",
  disconnecting: "Disconnecting your list",
} as const;

const installationErrors: Record<string, string> = {
  missing_template: "Notion did not return the Eat or Yeet shopping list. Start setup again and choose the template in Notion.",
  invalid_template: "The shopping list structure has changed. Retry setup, or reconnect the list if the problem continues.",
  access_revoked: "Notion access has expired or was removed. Reconnect your Notion account to continue.",
  temporarily_unavailable: "We could not reach Notion or the warning service. Retry setup in a moment.",
  setup_unavailable: "We could not finish setting up your list. Try again in a moment.",
  cancelled: "Notion access was not approved. You can start again whenever you are ready.",
  expired: "That setup link expired or was already used. Start again to protect your account.",
};

const queryMessages: Record<string, string> = {
  connected: "Your Notion list is connected.",
  updated: "Your warning country was changed. Unbought items are being reviewed again.",
  paused: "Reviews are paused.",
  resumed: "Reviews have resumed.",
  disconnected: "Your Notion connection is disconnected. Your shopping list stays in Notion.",
};

function firstValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function retryTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(timestamp);
}

export default async function NotionManagementPage({ searchParams }: { searchParams: Promise<{ error?: string | string[]; notice?: string | string[] }> }) {
  const [params, management] = await Promise.all([searchParams, getNotionManagement()]);
  const notice = queryMessages[firstValue(params.notice) ?? ""];
  const queryError = installationErrors[firstValue(params.error) ?? ""];
  const enabled = Boolean(getNotionSetupOrigin());

  if (!management) {
    // Only check a receipt after the live session no longer has an installation.
    const disconnectReceipt = await getNotionDisconnectReceipt();

    if (disconnectReceipt) {
      return (
        <div className="page-shell w-full py-8 sm:py-14">
          <div className="mx-auto max-w-[72ch]">
            <p className="text-sm font-bold text-muted-foreground">Eat or Yeet for Notion</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Notion list disconnected</h1>
            <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">Reviews have stopped and the saved Eat or Yeet connection has been removed. Your shopping list remains in Notion.</p>
            {disconnectReceipt.permissionRemoved ? (
              <p className="mt-4 rounded-xl border bg-muted/35 p-4 leading-6" role="status">Notion access was revoked.</p>
            ) : (
              <p className="mt-4 rounded-xl border bg-muted/35 p-4 leading-6" role="status">To finish removing access, open Notion Settings → Connections and remove Eat or Yeet.</p>
            )}
            {enabled && <Link className="mt-6 inline-flex min-h-12 items-center rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/integrations/notion">Connect another list</Link>}
          </div>
        </div>
      );
    }

    return (
      <div className="page-shell w-full py-8 sm:py-14">
        <div className="mx-auto max-w-[72ch]">
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Manage your Notion list</h1>
          {notice && <p className="mt-5 rounded-xl border bg-muted/35 p-4 leading-6" role="status" aria-live="polite">{notice}</p>}
          {queryError && <p className="mt-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 leading-6" role="alert">{queryError}</p>}
          <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">No connected Notion list was found for this browser. Connect through Notion to create a private management session.</p>
          {enabled ? (
            <Link className="mt-6 inline-flex min-h-12 items-center rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/integrations/notion">Add a Notion list</Link>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">Notion setup is not available yet. <Link className="font-semibold underline underline-offset-4" href="/integrations/notion">Read how it works</Link>.</p>
          )}
        </div>
      </div>
    );
  }

  const { installation, busy, budget, csrfToken } = management;
  const pendingStatus = installation.status === "disconnecting"
    ? "Disconnecting your list…"
    : busy && installation.status === "paused"
      ? "Pausing reviews…"
      : busy
        ? "Applying your change…"
        : undefined;
  const retryAt = retryTime(budget.retryAt);

  return (
    <div className="page-shell w-full py-8 sm:py-14">
      <div className="mx-auto max-w-[72ch]">
        <h1 className="text-4xl font-black tracking-tight text-pretty sm:text-5xl">Manage your Notion list</h1>
        {notice && <p className="mt-5 rounded-xl border bg-muted/35 p-4 leading-6" role="status" aria-live="polite">{notice}</p>}
        {queryError && <p className="mt-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 leading-6" role="alert">{queryError}</p>}

        <section className="mt-8 rounded-2xl border p-5 sm:p-7" aria-labelledby="notion-status">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="notion-status" className="text-xl font-black tracking-tight">{statusLabels[installation.status]}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Warning country: <span className="font-semibold text-foreground">{regionNames[installation.region]}</span></p>
            </div>
            <a className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/integrations/notion/manage">Refresh status</a>
          </div>

          {installation.status === "active" && <p className="mt-5 leading-7 text-muted-foreground">Changes to unbought shopping items are reviewed against published warnings for {regionNames[installation.region]}. Results appear beside the item when the review finishes.</p>}
          {installation.status === "paused" && <p className="mt-5 leading-7 text-muted-foreground">New reviews are paused. Your Notion list stays connected, and existing results keep their original review time.</p>}
          {pendingStatus && <p className="mt-5 rounded-xl border bg-muted/35 p-4 leading-6" role="status" aria-live="polite">{pendingStatus} Use Refresh status to check again after queued work has drained.</p>}
          {installation.errorCode && <p className="mt-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 leading-6" role="alert">{installationErrors[installation.errorCode] ?? "This list needs attention. Retry setup or reconnect your Notion account."}</p>}
          {installation.status === "active" && !busy && !budget.allowed && <p className="mt-5 rounded-xl border bg-muted/35 p-4 leading-6">Today&apos;s review limit has been reached. Pending reviews can retry after {retryAt ?? "the limit resets"}{retryAt ? " UTC" : ""}. Earlier results keep their original review time.</p>}

          {installation.status !== "disconnecting" && (
            <>
              <NotionManagementActions csrfToken={csrfToken} status={installation.status} region={installation.region} errorCode={installation.errorCode} />
              <div className="mt-5 border-t pt-4">
                <a className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={`/api/notion/connect?region=${installation.region}`}>Reconnect Notion</a>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Reconnect uses this browser’s private management session to find your existing list.</p>
              </div>
            </>
          )}

          {installation.status === "disconnecting" && <p className="mt-5 text-sm leading-6 text-muted-foreground">Disconnect waits for in-flight work to finish, then removes the saved connection. Your shopping list stays in Notion.</p>}
        </section>

        <section className="mt-8" aria-labelledby="review-limits">
          <h2 id="review-limits" className="text-lg font-bold" >What reviews do</h2>
          <p className="mt-2 leading-7 text-muted-foreground">Reviews run when an item changes. Bought items are skipped. Related warnings can describe a product or batch, so compare the linked official notice with the packet. No match does not establish that food is safe. Missing or stale source coverage shows “Unable to review”.</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Future-recall monitoring and push notifications are not included.</p>
          <Link className="mt-4 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/privacy">Read how connected-list data is handled</Link>
        </section>
      </div>
    </div>
  );
}
