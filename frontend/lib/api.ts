export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
}

/** User-facing hint when the browser cannot reach the API (backend down, wrong URL, CORS). */
export function apiReachabilityHint(error: unknown): string {
  const raw = String(error);
  const lower = raw.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed")
  ) {
    return `Cannot reach the API at ${apiBaseUrl()}. Start the FastAPI backend (e.g. uvicorn on port 8000), set NEXT_PUBLIC_API_URL in frontend/.env.local if the API is elsewhere, and ensure the server allows your UI origin in CORS. Raw error: ${raw}`;
  }
  return raw;
}

export type Role = {
  id: string;
  title: string;
  jd_text: string;
  created_at: string;
  updated_at: string;
};

export type Candidate = {
  id: string;
  role_id: string;
  role_title: string;
  name: string | null;
  score: number | null;
  justification: string | null;
  parse_status: string;
  duplicate_warning: string | null;
  extracted_data: Record<string, unknown>;
  created_at: string;
  /** SHA-256 hex of uploaded file bytes (exact duplicate key per role). */
  file_hash: string;
  /** SimHash of normalized resume text (near-duplicate detection). */
  content_hash: string;
};

/** How fit is scored: full parsed resume text vs structured extraction JSON only. */
export type ScoreBasis = "full_resume" | "extracted_values";

export type ResumeLibraryItem = {
  candidate_id: string;
  role_id: string;
  role_title: string;
  name: string | null;
  original_filename: string | null;
  mime_type: string | null;
  score: number | null;
  parse_status: string;
  created_at: string;
};

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

/** Direct URL for opening/downloading the original file (GET returns bytes from GridFS). */
export function apiDownloadResumeUrl(candidateId: string): string {
  return `${apiBaseUrl()}/api/candidates/${candidateId}/file`;
}

export const api = {
  listRoles: () => j<Role[]>("/api/roles"),
  createRole: (body: { id?: string; title: string; jd_text: string }) =>
    j<Role>("/api/roles", { method: "POST", body: JSON.stringify(body) }),
  updateRole: (id: string, body: { title?: string; jd_text?: string }) =>
    j<Role>(`/api/roles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRole: (id: string) => j<void>(`/api/roles/${id}`, { method: "DELETE" }),
  applicantCounts: () => j<Record<string, number>>("/api/roles/applicant-counts"),
  libraryResumes: (roleId?: string) =>
    j<ResumeLibraryItem[]>(
      roleId ? `/api/candidates/library?role_id=${encodeURIComponent(roleId)}` : "/api/candidates/library",
    ),
  defaultExtraction: () => j<{ version?: number; fields: unknown[] }>("/api/config/default-extraction"),
  jdTemplates: () =>
    j<{
      version?: number;
      templates?: {
        role_name: string;
        jd_description: string;
        extraction_fields: { key: string; label: string; type: string; description: string }[];
      }[];
    }>("/api/config/jd-templates"),
  listResults: (roleId: string) => j<Candidate[]>(`/api/results?role_id=${roleId}`),
  upload: async (
    roleId: string,
    file: File,
    extractionConfig?: { version?: number; fields: unknown[] },
  ) => {
    const fd = new FormData();
    fd.append("role_id", roleId);
    fd.append("extraction_config", JSON.stringify(extractionConfig ?? { version: 1, fields: [] }));
    fd.append("file", file);
    const r = await fetch(`${apiBaseUrl()}/api/upload`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json() as Promise<{
      candidate_id: string | null;
      duplicate_exact: boolean;
      near_duplicate_warning: string | null;
      message: string;
    }>;
  },
  rescan: (role_id: string, extraction_config: object) =>
    j<{ status: string }>("/api/rescan", { method: "POST", body: JSON.stringify({ role_id, extraction_config }) }),
  extract: (candidate_id: string, extraction_config: object) =>
    j<Candidate>("/api/extract", { method: "POST", body: JSON.stringify({ candidate_id, extraction_config }) }),
  score: (candidate_id: string, score_basis: ScoreBasis = "full_resume") =>
    j<Candidate>("/api/score", { method: "POST", body: JSON.stringify({ candidate_id, score_basis }) }),
  rankMulti: (candidate_id: string, role_ids: string[]) =>
    j<{ results: { role_id: string; role_title?: string; score?: number; justification?: string; error?: string }[] }>(
      "/api/rank-multi",
      { method: "POST", body: JSON.stringify({ candidate_id, role_ids }) },
    ),
};
