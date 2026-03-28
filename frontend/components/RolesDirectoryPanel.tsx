"use client";

import type { Role } from "@/lib/api";

type Props = {
  roles: Role[];
  loading?: boolean;
  onPickRole: (roleId: string) => void;
  onRefresh: () => void;
  /** Inserts a row into Postgres `roles` via POST /api/roles (same as Screening workflow → Create role). */
  onCreateRole: () => void;
};

export function RolesDirectoryPanel({ roles, loading, onPickRole, onRefresh, onCreateRole }: Props) {
  return (
    <main className="relative mx-auto max-w-4xl space-y-6 px-4 py-8 pb-24">
      <div className="rounded-2xl border border-slate-700/70 border-l-4 border-l-violet-400 bg-slate-900/55 p-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-violet-50">Open roles</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              This list is <strong className="text-slate-200">SELECT * FROM roles</strong> (newest first). Creating a role inserts into that table. Resume
              uploads live in <strong className="text-slate-200">candidates</strong> with <code className="text-cyan-200/90">role_id</code> pointing at the
              role—same filter the API uses for results and the library.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-accent text-xs" disabled={loading} onClick={() => onCreateRole()}>
              Create role
            </button>
            <button type="button" className="btn-neutral text-xs" disabled={loading} onClick={() => onRefresh()}>
              {loading ? "Refreshing…" : "Refresh from API"}
            </button>
          </div>
        </div>
      </div>

      {roles.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-600 bg-slate-950/50 px-6 py-12 text-center">
          <p className="font-medium text-slate-300">No roles in Postgres yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Use <strong className="text-slate-400">Create role</strong> above to insert into the <code className="text-cyan-300/90">roles</code> table, or
            from the repo root (venv): <code className="text-cyan-300/90">python scripts/seed_roles.py</code>
          </p>
          <button type="button" className="btn-accent mt-6 text-sm" disabled={loading} onClick={() => onCreateRole()}>
            Create role
          </button>
        </div>
      ) : (
        <ul className="space-y-4">
          {roles.map((r) => (
            <li
              key={r.id}
              className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/40 shadow-lg shadow-black/20"
            >
              <div className="border-b border-slate-800 bg-slate-950/50 px-5 py-4">
                <h2 className="text-lg font-semibold text-white">{r.title}</h2>
                <p className="mt-1 font-mono text-[11px] text-slate-500">id · {r.id}</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Job description</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{r.jd_text || "—"}</p>
                <button type="button" className="btn-accent mt-5 text-xs" onClick={() => onPickRole(r.id)}>
                  Use this role in screening
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
