"use client";

export function DashboardNotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-[color:var(--background)] p-8 text-center text-[color:var(--foreground)]">
      <div>
        <h1 className="font-semibold text-2xl">Dashboard route not found</h1>
        <p className="mt-2 text-[color:var(--muted)]">
          Open Inbox, Activity, or a Base from the sidebar.
        </p>
      </div>
    </div>
  );
}
