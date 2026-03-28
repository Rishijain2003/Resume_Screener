"use client";

import { apiDownloadResumeUrl, type ResumeLibraryItem, type Role } from "@/lib/api";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type Props = {
  rows: ResumeLibraryItem[];
  loading: boolean;
  filterRoleId?: string;
  roles: Role[];
  onRefresh: () => void;
};

export function ResumeLibraryPanel({ rows, loading, filterRoleId, roles, onRefresh }: Props) {
  const filterTitle = filterRoleId ? roles.find((r) => r.id === filterRoleId)?.title : null;

  return (
    <main className="relative mx-auto max-w-6xl space-y-6 px-4 py-8 pb-24">
      <div className="rounded-2xl border border-slate-700/70 border-l-4 border-l-cyan-400 bg-slate-900/55 p-6 shadow-xl backdrop-blur-md">
        <h1 className="text-xl font-bold text-cyan-50">Resume library</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Each row is one upload: metadata and scores from <strong className="text-slate-200">Postgres</strong>, original file from{" "}
          <strong className="text-slate-200">MongoDB GridFS</strong>. Download streams the stored file through the API.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {filterRoleId ? (
            <span className="rounded-lg border border-violet-500/40 bg-violet-950/40 px-3 py-1.5 text-xs font-medium text-violet-200">
              Filter: {filterTitle ?? filterRoleId.slice(0, 8) + "…"}
            </span>
          ) : (
            <span className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-400">All roles (max 500)</span>
          )}
          <button type="button" className="btn-neutral text-xs" disabled={loading} onClick={() => onRefresh()}>
            {loading ? "Loading…" : "Refresh list"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700/60">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-950/80 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-3 py-3">Candidate</th>
              <th className="py-3 pr-3">Job role</th>
              <th className="py-3 pr-3">File</th>
              <th className="py-3 pr-3">Status</th>
              <th className="py-3 pr-3">Score</th>
              <th className="py-3 pr-3">Uploaded</th>
              <th className="px-3 py-3">File</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  Loading from API…
                </td>
              </tr>
            ) : null}
            {!loading && !rows.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  <p className="font-medium text-slate-400">No resumes in this view</p>
                  <p className="mt-1 text-xs">Upload from the screening workflow or pick another role in the menu.</p>
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.candidate_id} className="border-b border-slate-800/90 hover:bg-slate-800/30">
                <td className="px-3 py-3 font-medium text-slate-100">{r.name || "—"}</td>
                <td className="py-3 pr-3 text-slate-300">{r.role_title}</td>
                <td className="max-w-[12rem] truncate py-3 pr-3 font-mono text-xs text-slate-400" title={r.original_filename ?? ""}>
                  {r.original_filename || "—"}
                </td>
                <td className="py-3 pr-3 text-slate-400">{r.parse_status}</td>
                <td className="py-3 pr-3 text-slate-200">{r.score != null ? `${r.score}/10` : "—"}</td>
                <td className="py-3 pr-3 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-3">
                  <a
                    href={apiDownloadResumeUrl(r.candidate_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-lg border-2 border-cyan-500/50 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50"
                  >
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
