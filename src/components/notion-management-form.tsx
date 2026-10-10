"use client";

type ManagementAction = "pause" | "resume" | "retry" | "region" | "disconnect";
type InstallationStatus = "setting_up" | "active" | "paused" | "needs_reconnect" | "setup_failed" | "disconnecting";

const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function ActionForm({ csrfToken, action, label }: { csrfToken: string; action: Exclude<ManagementAction, "region">; label: string }) {
  return (
    <form method="post" action="/api/notion/manage" onSubmit={(event) => {
      if (action === "disconnect" && !window.confirm("Disconnect this Notion list? Its list will remain in Notion.")) event.preventDefault();
    }}>
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="action" value={action} />
      <button className={buttonClass} type="submit">{label}</button>
    </form>
  );
}

export function NotionManagementActions({ csrfToken, status, region, errorCode }: { csrfToken: string; status: InstallationStatus; region: "UK" | "US"; errorCode?: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      {status === "active" && <ActionForm csrfToken={csrfToken} action="pause" label="Pause reviews" />}
      {status === "paused" && <ActionForm csrfToken={csrfToken} action="resume" label="Resume reviews" />}
      {status === "setup_failed" && errorCode !== "missing_template" && <ActionForm csrfToken={csrfToken} action="retry" label="Retry setup" />}
      {status !== "disconnecting" && <ActionForm csrfToken={csrfToken} action="disconnect" label="Disconnect list" />}

      {status !== "disconnecting" && (
        <form method="post" action="/api/notion/manage" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="action" value="region" />
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground" htmlFor="notion-region">
            Warning country
            <select id="notion-region" name="region" defaultValue={region} className="min-h-11 rounded-lg border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="UK">United Kingdom</option>
              <option value="US">United States</option>
            </select>
          </label>
          <button className={buttonClass} type="submit">Change country</button>
        </form>
      )}
    </div>
  );
}
