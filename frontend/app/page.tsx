"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AppSidebar, type NavDestination } from "@/components/AppSidebar";
import { ResumeLibraryPanel } from "@/components/ResumeLibraryPanel";
import { RolesDirectoryPanel } from "@/components/RolesDirectoryPanel";
import {
  api,
  apiReachabilityHint,
  type Candidate,
  type Role,
  type ResumeLibraryItem,
  type ScoreBasis,
} from "@/lib/api";

export type ExtractionField = {
  key: string;
  label: string;
  type: string;
  description: string;
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300">—</span>;
  const tone =
    score >= 8 ? "bg-emerald-500/20 text-emerald-300" : score >= 5 ? "bg-amber-500/20 text-amber-200" : "bg-rose-500/20 text-rose-200";
  return <span className={`rounded px-2 py-0.5 text-sm font-semibold ${tone}`}>{score}/10</span>;
}

function buildExtractionConfig(fields: ExtractionField[]) {
  return { version: 1, fields: fields.filter((f) => f.key.trim() && f.label.trim()) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Per-role extraction variables: browser-only (not stored on `roles` in Postgres). */
const EXTRACT_STORAGE_PREFIX = "rs_extract_v1:";
function extractStorageKey(roleId: string): string {
  return `${EXTRACT_STORAGE_PREFIX}${roleId}`;
}

function parseOptionalRoleId(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (!UUID_RE.test(t)) throw new Error("Role ID must be a valid UUID, or leave the field empty to auto-generate one.");
  return t;
}

function rowToExtractField(f: unknown): ExtractionField {
  const o = f as Record<string, unknown>;
  return {
    key: String(o.key ?? ""),
    label: String(o.label ?? ""),
    type: String(o.type ?? "string"),
    description: String(o.description ?? ""),
  };
}

type StepTone = "sky" | "violet" | "emerald" | "amber" | "fuchsia" | "slate";

const stepSkin: Record<StepTone, { edge: string; badge: string; title: string }> = {
  sky: {
    edge: "border-l-sky-400",
    badge: "bg-sky-500/25 text-sky-100 ring-2 ring-sky-400/35",
    title: "text-sky-50",
  },
  violet: {
    edge: "border-l-violet-400",
    badge: "bg-violet-500/25 text-violet-100 ring-2 ring-violet-400/35",
    title: "text-violet-50",
  },
  emerald: {
    edge: "border-l-emerald-400",
    badge: "bg-emerald-500/25 text-emerald-100 ring-2 ring-emerald-400/35",
    title: "text-emerald-50",
  },
  amber: {
    edge: "border-l-amber-400",
    badge: "bg-amber-500/25 text-amber-100 ring-2 ring-amber-400/35",
    title: "text-amber-50",
  },
  fuchsia: {
    edge: "border-l-fuchsia-400",
    badge: "bg-fuchsia-500/25 text-fuchsia-100 ring-2 ring-fuchsia-400/35",
    title: "text-fuchsia-50",
  },
  slate: {
    edge: "border-l-slate-400",
    badge: "bg-slate-600/40 text-slate-100 ring-2 ring-slate-500/35",
    title: "text-slate-50",
  },
};

function StepCard({
  step,
  tone,
  title,
  hint,
  children,
}: {
  step: string | number;
  tone: StepTone;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const sk = stepSkin[tone];
  return (
    <section
      className={`rounded-2xl border border-slate-700/70 border-l-4 bg-slate-900/55 p-6 shadow-xl shadow-black/30 backdrop-blur-md ${sk.edge}`}
    >
      <header className="mb-5 flex flex-wrap items-start gap-3 border-b border-slate-700/40 pb-4">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold ${sk.badge}`}
          aria-hidden
        >
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={`text-lg font-semibold tracking-tight ${sk.title}`}>{title}</h2>
          {hint ? (
            <div className="mt-2 text-sm leading-relaxed text-slate-400 [&_code]:rounded [&_code]:bg-slate-950/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-cyan-200/90 [&_strong]:font-semibold [&_strong]:text-slate-200">
              {hint}
            </div>
          ) : null}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function WorkflowOverview({ active }: { active: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const tiles: { n: 1 | 2 | 3 | 4 | 5 | 6; label: string; detail: string; tone: StepTone }[] = [
    { n: 1, label: "Pick a role", detail: "Which opening is this resume for?", tone: "sky" },
    { n: 2, label: "JD & extract fields", detail: "Tell the AI what to pull from CVs", tone: "violet" },
    { n: 3, label: "Upload resume", detail: "Store file + hash + Mongo", tone: "emerald" },
    { n: 4, label: "Results table", detail: "Pick the candidate row to work on", tone: "amber" },
    { n: 5, label: "Extract variables", detail: "LLM fills dynamic fields for that row", tone: "emerald" },
    { n: 6, label: "Score", detail: "Full resume or extracted values vs JD", tone: "slate" },
  ];
  return (
    <nav aria-label="Typical workflow" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {tiles.map((t) => {
        const on = active === t.n;
        const sk = stepSkin[t.tone];
        return (
          <div
            key={t.n}
            className={`rounded-xl border-2 px-4 py-3 transition-all ${on ? `border-l-4 ${sk.edge} border-slate-600/30 bg-slate-900/70 ring-2 ring-cyan-400/20` : "border-slate-700/50 bg-slate-950/30"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${sk.badge}`}>{t.n}</span>
              <span className={`font-semibold ${on ? sk.title : "text-slate-300"}`}>{t.label}</span>
            </div>
            <p className="mt-2 pl-10 text-xs leading-snug text-slate-500">{t.detail}</p>
          </div>
        );
      })}
    </nav>
  );
}

function ExtractionFieldsEditor({
  fields,
  onChange,
  disabled,
}: {
  fields: ExtractionField[];
  onChange: (f: ExtractionField[]) => void;
  disabled?: boolean;
}) {
  const add = () =>
    onChange([...fields, { key: "", label: "", type: "string", description: "" }]);
  const remove = (i: number) => onChange(fields.filter((_, j) => j !== i));
  const patch = (i: number, p: Partial<ExtractionField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-300">What to read from each resume</p>
        <button
          type="button"
          disabled={disabled}
          className="rounded-lg border-2 border-violet-500/45 bg-violet-950/60 px-3 py-1.5 text-xs font-semibold text-violet-100 transition-colors hover:bg-violet-900/70 disabled:opacity-50"
          onClick={add}
        >
          + Add variable
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Each row becomes a column in results. Keys are stable machine names; labels are what you see in the table.
      </p>
      {fields.length === 0 && (
        <p className="rounded-lg border border-dashed border-violet-500/30 bg-violet-950/20 px-4 py-3 text-sm text-violet-200/90">
          No fields yet. Use <strong className="text-violet-100">Reset to defaults</strong> or a template, or add rows manually.
        </p>
      )}
      {fields.map((row, i) => (
        <div
          key={i}
          className="space-y-3 rounded-xl border-2 border-slate-700/80 bg-slate-950/50 p-4 shadow-inner shadow-black/20"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="field-label">Key (saved in API)</span>
              <input
                className="field-control font-mono text-xs"
                value={row.key}
                disabled={disabled}
                placeholder="e.g. years_of_experience"
                onChange={(e) => patch(i, { key: e.target.value.replace(/\s+/g, "_").toLowerCase() })}
              />
            </div>
            <div>
              <span className="field-label">Label (your words)</span>
              <input
                className="field-control"
                value={row.label}
                disabled={disabled}
                placeholder="e.g. Years of experience"
                onChange={(e) => patch(i, { label: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="field-label">Type</span>
              <select
                className="field-control-select"
                value={row.type}
                disabled={disabled}
                onChange={(e) => patch(i, { type: e.target.value })}
              >
                <option value="string">Text (string)</option>
                <option value="number">Number</option>
                <option value="list">List</option>
                <option value="boolean">Yes / No</option>
              </select>
            </div>
            <div className="flex items-end justify-end">
              <button
                type="button"
                disabled={disabled}
                className="text-sm font-medium text-rose-400 underline decoration-rose-400/50 hover:text-rose-300 disabled:opacity-50"
                onClick={() => remove(i)}
              >
                Remove row
              </button>
            </div>
          </div>
          <div>
            <span className="field-label">Hint for the model</span>
            <input
              className="field-control"
              value={row.description}
              disabled={disabled}
              placeholder="One line: what should the AI look for?"
              onChange={(e) => patch(i, { description: e.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rolesInitialLoad, setRolesInitialLoad] = useState(true);

  const [newTitle, setNewTitle] = useState("Backend Engineer");
  const [newJd, setNewJd] = useState(
    "We need a strong Python engineer with FastAPI, PostgreSQL, and LLM integration experience.",
  );
  const [extractFields, setExtractFields] = useState<ExtractionField[]>([]);
  const [extractHydrated, setExtractHydrated] = useState(true);
  const selectedRoleIdRef = useRef("");
  selectedRoleIdRef.current = selectedRoleId;

  const [jdTemplates, setJdTemplates] = useState<
    { role_name: string; jd_description: string; extraction_fields: ExtractionField[] }[]
  >([]);
  const [templatePick, setTemplatePick] = useState("");

  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  /** Last successful extract for the current row; shown only in step 5 (not in the table). */
  const [extractDetail, setExtractDetail] = useState<Candidate | null>(null);
  const [multiRoles, setMultiRoles] = useState<Record<string, boolean>>({});
  const [multiOut, setMultiOut] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [modalRoleId, setModalRoleId] = useState("");
  const [modalTitle, setModalTitle] = useState("");
  const [modalJd, setModalJd] = useState("");

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pageView, setPageView] = useState<"home" | "library" | "roles">("home");
  const [rolesDirLoading, setRolesDirLoading] = useState(false);
  const [libraryRoleFilter, setLibraryRoleFilter] = useState<string | undefined>(undefined);
  const [libraryRows, setLibraryRows] = useState<ResumeLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [applicantCounts, setApplicantCounts] = useState<Record<string, number>>({});
  const [scoreBasis, setScoreBasis] = useState<ScoreBasis>("full_resume");

  useEffect(() => {
    if (!selectedCandidate) {
      setExtractDetail(null);
      return;
    }
    setExtractDetail((prev) => (prev && prev.id !== selectedCandidate ? null : prev));
  }, [selectedCandidate]);

  const selectedCandidateRow = useMemo(
    () => results.find((c) => c.id === selectedCandidate),
    [results, selectedCandidate],
  );

  const canScoreSelectedCandidate = useMemo(() => {
    const c = selectedCandidateRow;
    if (!c) return false;
    if (c.parse_status === "failed") return false;
    if (scoreBasis === "extracted_values") {
      return c.parse_status === "parsed" || c.parse_status === "completed";
    }
    return (
      c.parse_status === "uploaded" ||
      c.parse_status === "pending" ||
      c.parse_status === "parsed" ||
      c.parse_status === "completed"
    );
  }, [selectedCandidateRow, scoreBasis]);

  const refreshApplicantCounts = useCallback(async () => {
    try {
      setApplicantCounts(await api.applicantCounts());
    } catch {
      /* ignore */
    }
  }, []);

  const goLibrary = useCallback(async (roleId?: string) => {
    setPageView("library");
    setLibraryRoleFilter(roleId);
    setLibraryLoading(true);
    setErr(null);
    try {
      setLibraryRows(await api.libraryResumes(roleId));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const onNavigate = useCallback(
    (d: NavDestination) => {
      if (d.type === "home") {
        setPageView("home");
        return;
      }
      if (d.type === "roles") {
        setPageView("roles");
        return;
      }
      if (d.type === "library-all") void goLibrary(undefined);
      if (d.type === "library-role") void goLibrary(d.roleId);
    },
    [goLibrary],
  );

  const refreshRoles = useCallback(async () => {
    const r = await api.listRoles();
    setRoles(r);
  }, []);

  useEffect(() => {
    void (async () => {
      setRolesInitialLoad(true);
      try {
        await refreshRoles();
        await refreshApplicantCounts();
      } catch (e) {
        setErr(apiReachabilityHint(e));
      } finally {
        setRolesInitialLoad(false);
      }
    })();
  }, [refreshRoles, refreshApplicantCounts]);

  useEffect(() => {
    if (mobileMenuOpen) {
      void refreshApplicantCounts();
      void refreshRoles();
    }
  }, [mobileMenuOpen, refreshApplicantCounts, refreshRoles]);

  useEffect(() => {
    if (pageView === "roles") void refreshRoles();
  }, [pageView, refreshRoles]);

  const refreshRolesDirectory = useCallback(async () => {
    setRolesDirLoading(true);
    setErr(null);
    try {
      await refreshRoles();
    } catch (e) {
      setErr(apiReachabilityHint(e));
    } finally {
      setRolesDirLoading(false);
    }
  }, [refreshRoles]);

  const pickRoleForScreening = useCallback((roleId: string) => {
    setSelectedRoleId(roleId);
    setPageView("home");
    setMobileMenuOpen(false);
  }, []);

  const refreshResults = useCallback(async () => {
    if (!selectedRoleId) {
      setResults([]);
      return;
    }
    const r = await api.listResults(selectedRoleId);
    setResults(r);
  }, [selectedRoleId]);

  useEffect(() => {
    void api
      .jdTemplates()
      .then((d) => setJdTemplates(d.templates || []))
      .catch(() => setJdTemplates([]));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refreshResults();
      } catch {
        setResults([]);
      }
    })();
  }, [refreshResults]);

  const activeRole = useMemo(() => roles.find((r) => r.id === selectedRoleId), [roles, selectedRoleId]);

  useEffect(() => {
    if (!activeRole) {
      setNewTitle("");
      setNewJd("");
      return;
    }
    setNewTitle(activeRole.title);
    setNewJd(activeRole.jd_text || "");
  }, [activeRole]);

  useEffect(() => {
    if (!activeRole?.id) {
      setExtractFields([]);
      setExtractHydrated(true);
      return;
    }
    const rid = activeRole.id;
    setExtractHydrated(false);
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(extractStorageKey(rid)) : null;
    if (raw) {
      try {
        const o = JSON.parse(raw) as { fields?: unknown[] };
        if (Array.isArray(o.fields) && o.fields.length) {
          setExtractFields(o.fields.map(rowToExtractField));
          setExtractHydrated(true);
          return;
        }
      } catch {
        /* use default */
      }
    }
    void api.defaultExtraction().then((d) => {
      if (selectedRoleIdRef.current !== rid) return;
      setExtractFields(Array.isArray(d.fields) && d.fields.length ? d.fields.map(rowToExtractField) : []);
      setExtractHydrated(true);
    });
  }, [activeRole?.id]);

  useEffect(() => {
    if (!extractHydrated || !activeRole?.id) return;
    const rid = activeRole.id;
    const t = window.setTimeout(() => {
      const ec = buildExtractionConfig(extractFields);
      if (!ec.fields.length || typeof localStorage === "undefined") return;
      localStorage.setItem(extractStorageKey(rid), JSON.stringify(ec));
    }, 500);
    return () => window.clearTimeout(t);
  }, [activeRole?.id, extractFields, extractHydrated]);

  const loadDefaultConfig = async () => {
    try {
      const d = await api.defaultExtraction();
      if (!d.fields?.length) throw new Error("No fields in default config.");
      setExtractFields(d.fields.map(rowToExtractField));
      setBanner("Loaded default extraction variables from server (config/default_extraction.json).");
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  };

  const applyTemplate = (indexStr: string) => {
    const i = parseInt(indexStr, 10);
    if (Number.isNaN(i) || !jdTemplates[i]) return;
    const t = jdTemplates[i];
    setNewTitle(t.role_name);
    setNewJd(t.jd_description);
    setExtractFields(t.extraction_fields.map((f) => ({ ...f })));
    setTemplatePick("");
    setBanner(`Imported template: ${t.role_name} (from config/jd_config.json). Save when ready.`);
    setErr(null);
  };

  const openCreateModal = () => {
    setModalRoleId("");
    setModalTitle("");
    setModalJd("");
    setCreateModalOpen(true);
    setErr(null);
  };

  const submitCreateModal = async () => {
    setBusy(true);
    setErr(null);
    try {
      const idOpt = parseOptionalRoleId(modalRoleId);
      const body: { id?: string; title: string; jd_text: string } = {
        title: modalTitle.trim() || "Untitled role",
        jd_text: modalJd,
      };
      if (idOpt) body.id = idOpt;
      const role = await api.createRole(body);
      const d = await api.defaultExtraction();
      const fields = Array.isArray(d.fields) && d.fields.length ? d.fields.map(rowToExtractField) : [];
      const extraction_config = buildExtractionConfig(fields);
      if (!extraction_config.fields.length) {
        throw new Error(
          "Role was created, but the server has no default extraction fields (check config/default_extraction.json). Add fields in step 2 before uploading.",
        );
      }
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(extractStorageKey(role.id), JSON.stringify(extraction_config));
      }
      await refreshRoles();
      setSelectedRoleId(role.id);
      setCreateModalOpen(false);
      setBanner(`Role created: ${role.title}. Default extraction fields from the server are saved in this browser for uploads.`);
      await refreshApplicantCounts();
    } catch (e) {
      setErr(apiReachabilityHint(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelectedRole = async () => {
    if (!selectedRoleId) return;
    const r = roles.find((x) => x.id === selectedRoleId);
    const label = r?.title ?? selectedRoleId;
    if (!window.confirm(`Delete role "${label}" and all candidates under it in the database? This cannot be undone.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteRole(selectedRoleId);
      setSelectedRoleId("");
      setBanner(`Deleted role "${label}".`);
      await refreshRoles();
      await refreshApplicantCounts();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveRolePatch = async () => {
    if (!selectedRoleId) return;
    setBusy(true);
    setErr(null);
    try {
      await api.updateRole(selectedRoleId, {
        title: newTitle.trim() || undefined,
        jd_text: newJd,
      });
      setBanner("Role updated (title + JD). Extraction variables stay in this browser (per role).");
      await refreshRoles();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!selectedRoleId) {
      toast.error("Select a job role in step 1 before uploading.");
      return;
    }
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const extraction_config = buildExtractionConfig(extractFields);
      const res = await api.upload(
        selectedRoleId,
        f,
        extraction_config.fields.length ? extraction_config : undefined,
      );
      if (res.duplicate_exact) {
        toast.warning("Resume already in the database", {
          description: `This exact file is already stored for this role (same fingerprint/hash). Candidate id: ${res.candidate_id}. No duplicate row was added. Open that row in the table below or pick a different file.`,
          duration: 14_000,
        });
      } else if (res.near_duplicate_warning) {
        toast.success(res.message, {
          description: res.near_duplicate_warning,
          duration: 10_000,
        });
      } else {
        toast.success(res.message);
      }
      setTimeout(() => void refreshResults(), 2000);
      setTimeout(() => void refreshResults(), 8000);
      void refreshApplicantCounts();
      if (pageView === "library") void goLibrary(libraryRoleFilter);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const rescan = async () => {
    if (!selectedRoleId) return;
    const extraction_config = buildExtractionConfig(extractFields);
    if (!extraction_config.fields.length) {
      setErr("Add at least one extraction variable in step 2 before re-scanning.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.rescan(selectedRoleId, extraction_config);
      setBanner("Re-scan started: files re-parsed and fields re-extracted in the background (scores cleared until you run Score).");
      setTimeout(() => void refreshResults(), 4000);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const rescore = async () => {
    if (!selectedCandidate || !canScoreSelectedCandidate) return;
    setBusy(true);
    setErr(null);
    try {
      await api.score(selectedCandidate, scoreBasis);
      setBanner("Score updated for selected candidate (same row in the database).");
      await refreshResults();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const extractSelected = async () => {
    if (!selectedCandidate) return;
    const extraction_config = buildExtractionConfig(extractFields);
    if (!extraction_config.fields.length) {
      toast.error("Add at least one extraction variable in step 2 before extracting.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const updated = await api.extract(selectedCandidate, extraction_config);
      setExtractDetail(updated);
      await refreshResults();
    } catch (e) {
      const msg = String(e);
      setExtractDetail(null);
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const rankMulti = async () => {
    if (!selectedCandidate) return;
    const ids = Object.entries(multiRoles).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) {
      setErr("Select at least one target role for multi-rank.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.rankMulti(selectedCandidate, ids);
      setMultiOut(JSON.stringify(r.results, null, 2));
      setBanner("Multi-role scoring complete.");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const workflowHighlight = useMemo<1 | 2 | 3 | 4 | 5 | 6>(() => {
    if (!selectedRoleId) return 1;
    if (results.length > 0) return 4;
    return 3;
  }, [selectedRoleId, results.length]);

  return (
    <>
      <AppSidebar
        pageView={pageView}
        libraryFilterRoleId={pageView === "library" ? libraryRoleFilter : undefined}
        roles={roles}
        applicantCounts={applicantCounts}
        rolesLoading={rolesInitialLoad}
        onNavigate={onNavigate}
        mobileOpen={mobileMenuOpen}
        setMobileOpen={setMobileMenuOpen}
      />
      <button
        type="button"
        className="fixed left-3 top-3 z-40 flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-slate-900/95 px-3 py-2 text-sm font-semibold text-cyan-100 shadow-lg backdrop-blur-sm md:hidden"
        aria-label="Open navigation menu"
        onClick={() => setMobileMenuOpen(true)}
      >
        <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        Menu
      </button>
      {busy ? (
        <div
          className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-1 bg-gradient-to-r from-cyan-500 via-violet-500 to-emerald-500 animate-pulse"
          aria-hidden
        />
      ) : null}

      <div className="min-h-screen pl-0 pt-14 md:pt-0 md:pl-[17.5rem]">
        {banner ? (
          <div className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-emerald-500/35 bg-emerald-950/35 px-4 py-4 text-sm text-emerald-100 shadow-lg shadow-emerald-950/20 sm:px-5">
            <span>{banner}</span>
            <button type="button" className="btn-ghost shrink-0 px-3 py-1 text-xs text-emerald-200/80" onClick={() => setBanner(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {err ? (
          <div className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-rose-500/40 bg-rose-950/50 px-4 py-4 text-sm text-rose-100 shadow-lg shadow-rose-950/30 sm:px-5">
            <span>{err}</span>
            <button type="button" className="btn-ghost shrink-0 px-3 py-1 text-xs text-rose-200/90" onClick={() => setErr(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {pageView === "library" ? (
          <ResumeLibraryPanel
            rows={libraryRows}
            loading={libraryLoading}
            filterRoleId={libraryRoleFilter}
            roles={roles}
            onRefresh={() => void goLibrary(libraryRoleFilter)}
          />
        ) : pageView === "roles" ? (
          <RolesDirectoryPanel
            roles={roles}
            loading={rolesDirLoading}
            onPickRole={pickRoleForScreening}
            onRefresh={() => void refreshRolesDirectory()}
            onCreateRole={() => openCreateModal()}
          />
        ) : (
          <main className="relative mx-auto max-w-6xl space-y-8 px-4 py-10 pb-20">
      <header className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/50 p-8 shadow-2xl shadow-black/40 backdrop-blur-md">
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="relative space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400/90">Resume screener</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Screen candidates in a few steps</h1>
        </div>
      </header>

      <WorkflowOverview active={workflowHighlight} />

      <StepCard
        step={1}
        tone="sky"
        title="Select a job role"
        hint={
          <>
            Each role is one opening (title + JD + extract fields). Stored in <strong>Postgres</strong> with a permanent{" "}
            <code>id</code> you can copy for APIs.
          </>
        }
      >
        {roles.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-sky-500/30 bg-sky-950/20 px-4 py-5 text-sm text-sky-100/90">
            <p className="font-medium text-sky-100">No roles yet</p>
            <p className="mt-1 text-sky-200/70">
              Use <strong className="text-sky-100">Create role</strong> next to the role list (or create roles from the Roles directory in the sidebar).
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[min(100%,18rem)] flex-1">
            <span className="field-label text-sky-200/80">Job role</span>
            <select
              className="field-control-select"
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
            >
              <option value="">Choose a role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} — {r.id.slice(0, 8)}…
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} className="btn-accent" onClick={() => openCreateModal()}>
            Create role
          </button>
          <button type="button" disabled={busy} className="btn-neutral" onClick={() => void refreshRoles()}>
            Refresh list
          </button>
          <button type="button" disabled={busy || !selectedRoleId} className="btn-danger" onClick={() => void deleteSelectedRole()}>
            Delete role
          </button>
        </div>
        {selectedRoleId && activeRole ? (
          <div className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-400">
            <span className="text-slate-500">Role id · </span>
            <span className="break-all text-cyan-200/90">{activeRole.id}</span>
          </div>
        ) : null}
      </StepCard>

      <StepCard
        step={2}
        tone="violet"
        title="Job description & fields to extract"
        hint="Save writes title + JD to the database. Extraction variables are kept in this browser (per role) and are sent with each upload and re-scan — they are not stored on the role row in Postgres."
      >
        {!selectedRoleId ? (
          <div className="rounded-xl border-2 border-dashed border-violet-500/25 bg-violet-950/15 px-4 py-6 text-center text-sm text-violet-200/80">
            <p className="font-medium text-violet-100">Choose a role in step 1 first</p>
            <p className="mt-1 text-violet-200/60">Then you can edit that role’s text and extraction schema.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} className="btn-neutral text-xs" onClick={() => void loadDefaultConfig()}>
                Reset to default fields
              </button>
              {jdTemplates.length > 0 ? (
                <select
                  className="field-control-select max-w-xs text-xs"
                  value={templatePick}
                  disabled={busy}
                  onChange={(e) => {
                    setTemplatePick(e.target.value);
                    if (e.target.value) applyTemplate(e.target.value);
                  }}
                >
                  <option value="">Load template from jd_config…</option>
                  {jdTemplates.map((t, i) => (
                    <option key={i} value={String(i)}>
                      {t.role_name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div>
              <span className="field-label text-violet-200/70">Role title (shown in lists)</span>
              <input className="field-control" value={newTitle} disabled={busy} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <div>
              <span className="field-label text-violet-200/70">Full job description</span>
              <textarea className="field-control min-h-[9rem] resize-y" value={newJd} disabled={busy} onChange={(e) => setNewJd(e.target.value)} />
            </div>
            <ExtractionFieldsEditor fields={extractFields} onChange={setExtractFields} disabled={busy} />
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-700/50 pt-4">
              <button type="button" disabled={busy} className="btn-accent" onClick={() => void saveRolePatch()}>
                Save to this role
              </button>
              <span className="text-xs text-slate-500">Required before uploads match your latest JD and fields.</span>
            </div>
          </>
        )}
      </StepCard>

      <StepCard
        step={3}
        tone="emerald"
        title="Upload resumes"
        hint="Saves SHA-256 fingerprint, new row, and file bytes in Mongo. Pick the row in step 4, then extract (step 5) and score (step 6)."
      >
        {!selectedRoleId ? (
          <div className="rounded-xl border-2 border-amber-500/30 bg-amber-950/25 px-4 py-4 text-sm text-amber-100">
            <span className="font-semibold text-amber-50">Almost there — </span>
            select a role in step 1, then come back here to pick a file.
          </div>
        ) : null}
        <label className="upload-tile block max-w-xl">
          <span className="text-base font-semibold text-cyan-300">Choose resume</span>
          <span className="text-xs text-slate-500">PDF or Word → stored only; use Extract on a selected row for variables</span>
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void onUpload(e)}
          />
        </label>
        <div className="flex flex-wrap gap-2 border-t border-slate-700/50 pt-4">
          <button type="button" disabled={busy || !selectedRoleId} className="btn-neutral" onClick={() => void refreshResults()}>
            Refresh results table
          </button>
          <button type="button" disabled={busy || !selectedRoleId} className="btn-primary border-amber-500/40 bg-amber-600/90 hover:bg-amber-500 focus:ring-amber-400" onClick={() => void rescan()}>
            Re-scan all for this role
          </button>
        </div>
      </StepCard>

      <StepCard
        step={4}
        tone="amber"
        title="Results — pick a candidate"
        hint="Select exactly one row with the radio control. You need a selection for steps 5 and 6. Unscored rows sort last; open Details to see extracted JSON and justification after you run those steps."
      >
        {!selectedRoleId ? (
          <p className="text-sm text-amber-200/60">Select a role in step 1 to load its candidates.</p>
        ) : null}
        <div className="overflow-x-auto rounded-xl border border-slate-700/60">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-950/80 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-3 py-3 pr-4">Pick</th>
                <th className="py-3 pr-4">Name</th>
                <th className="py-3 pr-4">Score</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Warnings</th>
                <th className="px-3 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {results.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-800/90 transition-colors hover:bg-amber-950/10"
                >
                  <td className="px-3 py-3 pr-4">
                    <input
                      type="radio"
                      name="cand"
                      className="h-4 w-4 accent-amber-500"
                      checked={selectedCandidate === c.id}
                      onChange={() => setSelectedCandidate(c.id)}
                    />
                  </td>
                  <td className="py-3 pr-4 font-medium text-slate-100">{c.name || "—"}</td>
                  <td className="py-3 pr-4">
                    <ScoreBadge score={c.score} />
                  </td>
                  <td className="py-3 pr-4 text-slate-400">{c.parse_status}</td>
                  <td className="py-3 pr-4 text-xs text-amber-200/90">{c.duplicate_warning || "—"}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="font-medium text-cyan-400 underline decoration-cyan-500/40 hover:text-cyan-300"
                      onClick={() => setExpanded((x) => ({ ...x, [c.id]: !x[c.id] }))}
                    >
                      {expanded[c.id] ? "Hide detail" : "Show detail"}
                    </button>
                  </td>
                </tr>
              ))}
              {!results.length && selectedRoleId ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    <p className="font-medium text-slate-400">No uploads for this role yet</p>
                    <p className="mt-1 text-sm text-slate-500">Use step 3 to add a PDF or DOCX.</p>
                  </td>
                </tr>
              ) : null}
              {!selectedRoleId ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-600">
                    Select a role to see candidates.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {results.map(
          (c) =>
            expanded[c.id] && (
              <div
                key={`d-${c.id}`}
                className="mt-4 space-y-3 rounded-xl border border-amber-500/20 bg-slate-950/70 p-5 text-sm shadow-inner"
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/70">Fit justification</p>
                  <p className="mt-1 text-slate-200">{c.justification || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/70">Stored hashes (dedupe)</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-400">
                    <span className="text-slate-500">File (SHA-256):</span> {c.file_hash || "—"}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-400">
                    <span className="text-slate-500">Content (SimHash):</span> {c.content_hash || "—"}
                  </p>
                </div>
              </div>
            ),
        )}
      </StepCard>

      <StepCard
        step={5}
        tone="emerald"
        title="Extract dynamic variables"
        hint="Uses the field definitions from step 2. Extraction output (name + variables) appears only in this section after you click Extract — not in the table."
      >
        {!selectedRoleId ? (
          <p className="text-sm text-slate-400">Select a role in step 1 first.</p>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              disabled={
                busy ||
                !selectedCandidate ||
                !buildExtractionConfig(extractFields).fields.length
              }
              className="btn-primary border-emerald-500/40 bg-emerald-700/90 hover:bg-emerald-600 focus:ring-emerald-400"
              onClick={() => void extractSelected()}
            >
              Extract
            </button>
            {!selectedCandidate ? (
              <p className="text-xs text-slate-500">Pick one row in the table (step 4), then click Extract.</p>
            ) : !buildExtractionConfig(extractFields).fields.length ? (
              <p className="text-xs text-amber-200/80">Add at least one extraction variable in step 2 first.</p>
            ) : (
              <p className="text-xs text-slate-500">Runs LLM extraction for the selected row only.</p>
            )}
            {extractDetail && extractDetail.id === selectedCandidate ? (
              <div className="mt-4 space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200/80">Extraction result</p>
                <div>
                  <p className="text-xs text-slate-500">Name</p>
                  <p className="mt-0.5 font-medium text-slate-100">{extractDetail.name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Status</p>
                  <p className="mt-0.5 text-slate-300">{extractDetail.parse_status}</p>
                </div>
                {extractDetail.duplicate_warning ? (
                  <div>
                    <p className="text-xs text-slate-500">Warning</p>
                    <p className="mt-0.5 text-xs text-amber-200/90">{extractDetail.duplicate_warning}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200/70">Dynamic variables</p>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-700 bg-black/50 p-4 text-xs text-slate-300">
                    {JSON.stringify(extractDetail.extracted_data, null, 2)}
                  </pre>
                </div>
              </div>
            ) : selectedCandidate && buildExtractionConfig(extractFields).fields.length ? (
              <p className="text-xs text-slate-600">No extraction shown yet for this row — click Extract.</p>
            ) : null}
          </div>
        )}
      </StepCard>

      <StepCard
        step={6}
        tone="slate"
        title="Score"
        hint="Pick how the fit score is computed, then score the same row you selected in step 4. The table updates with the new score and justification."
      >
        {!selectedRoleId ? (
          <p className="text-sm text-slate-400">Select a role in step 1 first.</p>
        ) : (
          <div className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-600/80 bg-slate-950/50 p-4 has-[:checked]:border-cyan-500/50 has-[:checked]:bg-cyan-950/20">
              <input
                type="radio"
                name="scoreBasis"
                className="mt-1 h-4 w-4 accent-cyan-500"
                checked={scoreBasis === "full_resume"}
                onChange={() => setScoreBasis("full_resume")}
              />
              <span>
                <span className="font-semibold text-slate-100">Score from full resume content</span>
                <span className="mt-1 block text-sm text-slate-400">Parsed PDF/DOCX text is compared to the job description.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-600/80 bg-slate-950/50 p-4 has-[:checked]:border-violet-500/50 has-[:checked]:bg-violet-950/20">
              <input
                type="radio"
                name="scoreBasis"
                className="mt-1 h-4 w-4 accent-violet-500"
                checked={scoreBasis === "extracted_values"}
                onChange={() => setScoreBasis("extracted_values")}
              />
              <span>
                <span className="font-semibold text-slate-100">Score from extracted values</span>
                <span className="mt-1 block text-sm text-slate-400">
                  Only the structured fields from step 2 are compared to the JD (run Extract in step 5 first).
                </span>
              </span>
            </label>
            <div className="border-t border-slate-700/50 pt-4">
              <button
                type="button"
                disabled={busy || !selectedCandidate || !canScoreSelectedCandidate}
                className="btn-accent"
                onClick={() => void rescore()}
              >
                Score
              </button>
              {!selectedCandidate ? (
                <p className="mt-3 text-xs text-slate-500">Select a candidate in step 4 before scoring.</p>
              ) : !canScoreSelectedCandidate ? (
                <p className="mt-3 text-xs text-slate-500">
                  {scoreBasis === "extracted_values"
                    ? "Scoring from extracted values requires status parsed or completed — run Extract (step 5) first."
                    : "Cannot score this row (for example failed parse). Fix the file or try Extract again."}
                </p>
              ) : (
                <p className="mt-3 text-xs text-slate-500">Starts scoring for the selected row and refreshes the table.</p>
              )}
            </div>
          </div>
        )}
      </StepCard>

      <section className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl border border-slate-700/70 border-l-4 border-l-slate-400 bg-slate-900/55 p-6 shadow-xl backdrop-blur-md">
          <h2 className="text-lg font-semibold text-slate-100">Compare one resume to many roles</h2>
          <p className="mt-2 text-sm text-slate-400">Tick other openings, then rank the selected candidate against each JD.</p>
          <div className="mt-4 max-h-44 space-y-2 overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-950/50 p-3">
            {roles.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-800/60">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-500 accent-violet-500"
                  checked={!!multiRoles[r.id]}
                  onChange={(e) => setMultiRoles((m) => ({ ...m, [r.id]: e.target.checked }))}
                />
                <span className="text-slate-200">{r.title}</span>
              </label>
            ))}
            {roles.length <= 1 ? <p className="text-xs text-slate-500">Add more roles to compare side by side.</p> : null}
          </div>
          <button type="button" disabled={busy || !selectedCandidate} className="btn-neutral mt-4" onClick={() => void rankMulti()}>
            Run multi-role rank
          </button>
          {multiOut ? (
            <pre className="mt-4 max-h-64 overflow-auto rounded-xl border border-slate-700 bg-black/40 p-4 font-mono text-xs text-slate-300">
              {multiOut}
            </pre>
          ) : null}
        </div>
      </section>
          </main>
        )}
      </div>

      {createModalOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => !busy && setCreateModalOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border-2 border-fuchsia-500/30 border-l-4 border-l-fuchsia-400 bg-slate-900/95 p-6 shadow-2xl shadow-fuchsia-950/20"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-role-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-role-title" className="text-xl font-bold text-fuchsia-100">
              Create new role
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Optional <strong className="text-slate-200">role ID</strong> must be a full UUID, or leave empty to let the server assign one.
            </p>
            <div className="mt-5 space-y-4">
              <div>
                <span className="field-label text-fuchsia-200/70">Role ID (optional)</span>
                <input
                  className="field-control font-mono text-xs"
                  value={modalRoleId}
                  disabled={busy}
                  placeholder="550e8400-e29b-41d4-a716-446655440000"
                  onChange={(e) => setModalRoleId(e.target.value)}
                />
              </div>
              <div>
                <span className="field-label text-fuchsia-200/70">Role name</span>
                <input
                  className="field-control"
                  value={modalTitle}
                  disabled={busy}
                  placeholder="e.g. Senior Backend Engineer"
                  onChange={(e) => setModalTitle(e.target.value)}
                />
              </div>
              <div>
                <span className="field-label text-fuchsia-200/70">Job description</span>
                <textarea className="field-control min-h-[8rem] resize-y" value={modalJd} disabled={busy} onChange={(e) => setModalJd(e.target.value)} />
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                After create, this browser loads <strong className="text-slate-400">default extraction fields</strong> from the server for uploads. You can change them anytime in{" "}
                <strong className="text-slate-400">Screening workflow</strong> → step 2.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap justify-end gap-2 border-t border-slate-700/80 pt-4">
              <button type="button" disabled={busy} className="btn-ghost" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </button>
              <button type="button" disabled={busy} className="btn-accent" onClick={() => void submitCreateModal()}>
                Create role
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
