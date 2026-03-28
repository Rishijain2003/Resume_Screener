"use client";

export type ExtractionField = {
  key: string;
  label: string;
  type: string;
  description: string;
};

export function buildExtractionConfig(fields: ExtractionField[]) {
  return { version: 1, fields: fields.filter((f) => f.key.trim() && f.label.trim()) };
}

export function ExtractionFieldsEditor({
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
        <span className="text-xs text-slate-500">Resume variables to extract</span>
        <button
          type="button"
          disabled={disabled}
          className="rounded-md border border-lilac-500/40 px-2 py-1 text-xs text-lilac-300 hover:bg-lilac-500/10 disabled:opacity-50"
          onClick={add}
        >
          + Add variable
        </button>
      </div>
      {fields.length === 0 && (
        <p className="text-sm text-slate-500">No fields. Add variables or load defaults / template.</p>
      )}
      {fields.map((row, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-slate-700 bg-ink-950 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-[10px] uppercase text-slate-500">Key</span>
              <input
                className="w-full rounded border border-slate-600 bg-ink-900 px-2 py-1.5 font-mono text-xs"
                value={row.key}
                disabled={disabled}
                placeholder="e.g. years_of_experience"
                onChange={(e) => patch(i, { key: e.target.value.replace(/\s+/g, "_").toLowerCase() })}
              />
            </div>
            <div>
              <span className="mb-1 block text-[10px] uppercase text-slate-500">Label</span>
              <input
                className="w-full rounded border border-slate-600 bg-ink-900 px-2 py-1.5 text-sm"
                value={row.label}
                disabled={disabled}
                onChange={(e) => patch(i, { label: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-[8rem] flex-1">
              <span className="mb-1 block text-[10px] uppercase text-slate-500">Type</span>
              <select
                className="w-full rounded border border-slate-600 bg-ink-900 px-2 py-1.5 text-sm"
                value={row.type}
                disabled={disabled}
                onChange={(e) => patch(i, { type: e.target.value })}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="list">list</option>
                <option value="boolean">boolean</option>
              </select>
            </div>
            <button
              type="button"
              disabled={disabled}
              className="text-sm text-rose-400 underline disabled:opacity-50"
              onClick={() => remove(i)}
            >
              Remove
            </button>
          </div>
          <div>
            <span className="mb-1 block text-[10px] uppercase text-slate-500">Description</span>
            <input
              className="w-full rounded border border-slate-600 bg-ink-900 px-2 py-1.5 text-sm"
              value={row.description}
              disabled={disabled}
              onChange={(e) => patch(i, { description: e.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
