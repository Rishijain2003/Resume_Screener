"use client";

import type { Role } from "@/lib/api";

export type NavDestination =
  | { type: "home" }
  | { type: "roles" }
  | { type: "library-all" }
  | { type: "library-role"; roleId: string };

type PageView = "home" | "library" | "roles";

type Props = {
  pageView: PageView;
  /** When on library view, which role filter is active (undefined = all). */
  libraryFilterRoleId?: string;
  roles: Role[];
  applicantCounts: Record<string, number>;
  /** First fetch of roles from API (show loading in sidebar list). */
  rolesLoading?: boolean;
  onNavigate: (d: NavDestination) => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
};

function navBtn(active: boolean, extra = "") {
  return `w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${active ? "bg-cyan-950/50 text-cyan-100 ring-1 ring-cyan-500/40" : "text-slate-200 hover:bg-slate-800/90"} ${extra}`;
}

export function AppSidebar({
  pageView,
  libraryFilterRoleId,
  roles,
  applicantCounts,
  rolesLoading = false,
  onNavigate,
  mobileOpen,
  setMobileOpen,
}: Props) {
  const run = (d: NavDestination) => {
    onNavigate(d);
    setMobileOpen(false);
  };

  const allResumesActive = pageView === "library" && libraryFilterRoleId === undefined;

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[108] bg-black/60 backdrop-blur-sm md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-[109] flex h-screen w-[17.5rem] flex-col border-r border-slate-700/90 bg-slate-950 shadow-2xl transition-transform duration-200 ease-out md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
        aria-label="Main navigation"
      >
        <div className="border-b border-slate-800 px-4 py-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">Sprinto</p>
          <p className="mt-1 text-lg font-bold leading-tight text-white">Resume Screener</p>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-3">
          <p className="shrink-0 px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Navigate</p>
          <button type="button" className={`${navBtn(pageView === "home")} shrink-0`} onClick={() => run({ type: "home" })}>
            Screening workflow
          </button>
          <button type="button" className={`${navBtn(pageView === "roles")} shrink-0`} onClick={() => run({ type: "roles" })}>
            Open roles
          </button>

          <p className="mb-1 mt-3 shrink-0 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Resumes</p>
          <button type="button" className={`${navBtn(allResumesActive)} shrink-0`} onClick={() => run({ type: "library-all" })}>
            All resumes
          </button>

          <p className="mb-1 mt-3 shrink-0 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Applicants by role</p>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 pb-2">
            {rolesLoading ? (
              <p className="px-2 py-3 text-xs italic text-slate-500">Loading roles…</p>
            ) : (
              roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={navBtn(pageView === "library" && libraryFilterRoleId === r.id, "flex items-center justify-between gap-2")}
                  onClick={() => run({ type: "library-role", roleId: r.id })}
                >
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                    {applicantCounts[r.id] ?? 0}
                  </span>
                </button>
              ))
            )}
          </div>
          {!rolesLoading && roles.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-500">
              No roles yet. Open <strong className="text-slate-400">Screening workflow</strong> and create a role, or run{" "}
              <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[10px]">python scripts/seed_roles.py</code>.
            </p>
          ) : null}
        </nav>
      </aside>
    </>
  );
}
