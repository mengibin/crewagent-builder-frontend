"use client";

export type DiffModel = {
  path: string;
  before: string;
  after: string;
  added: number;
  removed: number;
};

export type RevisionConflictDetail = {
  field: string;
  provided: string;
  current: string;
};

type MarkdownDiffPanelProps = {
  diffModel: DiffModel | null;
  revisionConflictDetails?: RevisionConflictDetail[];
};

export function MarkdownDiffPanel({ diffModel, revisionConflictDetails = [] }: MarkdownDiffPanelProps) {
  return (
    <section className="rounded-[20px] border border-[#DDE3EE] bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#1F2937]">
          Markdown diff{diffModel?.path ? ` · ${diffModel.path}` : ""}
        </p>
        <span className="rounded-full border border-[#DDE3EE] bg-[#F8FAFC] px-3 py-1 text-[11px] font-semibold text-[#5F6B82]">
          +{diffModel?.added ?? 0}/-{diffModel?.removed ?? 0}
        </span>
      </div>

      {revisionConflictDetails.length ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800">Revision conflict</p>
          <p className="mt-1 text-[11px] text-amber-700">Apply is disabled. Refresh target context and regenerate suggestions.</p>
          <div className="mt-2 space-y-1">
            {revisionConflictDetails.map((detail) => (
              <div
                key={`${detail.field}:${detail.provided}:${detail.current}`}
                className="grid grid-cols-[1.25fr_1fr_1fr] gap-2 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px] text-amber-900"
              >
                <span className="truncate font-semibold">{detail.field}</span>
                <span className="truncate">provided: {detail.provided}</span>
                <span className="truncate">current: {detail.current}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!diffModel ? (
        <p className="mt-3 rounded-xl border border-dashed border-[#DDE3EE] bg-[#F8FAFC] px-3 py-4 text-center text-xs text-[#94A0B8]">
          Select a changed file to inspect before/after diff.
        </p>
      ) : (
        <div className="mt-3 grid min-h-0 gap-3 lg:grid-cols-2">
          <div className="min-h-0 rounded-xl border border-[#F1D5D8] bg-[#FFF5F5] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#C53030]">Before</p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[#6B2231]">
              {diffModel.before || "(empty)"}
            </pre>
          </div>
          <div className="min-h-0 rounded-xl border border-[#CCE7D6] bg-[#F4FBF7] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2F855A]">After</p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[#1F5D3A]">
              {diffModel.after || "(empty)"}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}

