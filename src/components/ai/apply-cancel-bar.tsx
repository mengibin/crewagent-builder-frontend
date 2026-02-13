"use client";

type ApplyCancelBarProps = {
  policyTitle: string;
  contextHint: string;
  applyMetaText: string;
  canApply: boolean;
  applying: boolean;
  conflict?: boolean;
  onResolveConflict?: (() => void) | null;
  onCancel: () => void;
  onApply: () => void;
  errorMessage?: string | null;
};

export function ApplyCancelBar({
  policyTitle,
  contextHint,
  applyMetaText,
  canApply,
  applying,
  conflict = false,
  onResolveConflict = null,
  onCancel,
  onApply,
  errorMessage,
}: ApplyCancelBarProps) {
  return (
    <section className="rounded-[20px] border border-[#DDE3EE] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-[#1F2937]">{policyTitle}</p>
          <p className="text-xs text-[#5F6B82]">{contextHint}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {conflict && onResolveConflict ? (
            <button
              type="button"
              onClick={onResolveConflict}
              disabled={applying}
              className="rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-4 py-1.5 text-xs font-semibold text-[#4F46E5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh and regenerate
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="rounded-full border border-[#DDE3EE] bg-white px-4 py-1.5 text-xs font-semibold text-[#5F6B82] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel and return
          </button>
          <span className="rounded-full border border-[#DDE3EE] bg-[#F8FAFC] px-3 py-1 text-[11px] font-semibold text-[#5F6B82]">
            {applyMetaText}
          </span>
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply || applying || conflict}
            className="rounded-full border border-[#C7D2FE] bg-[#4F46E5] px-4 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,0.28)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? "Applying..." : conflict ? "Resolve conflict to apply" : "Apply changes"}
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{errorMessage}</div>
      ) : null}
    </section>
  );
}
