"use client";

export type PreviewValidationTone = "valid" | "invalid" | "neutral";

export type ChangedFileItem = {
  path: string;
  changeType: "A" | "M" | "D";
};

type ChangePreviewPaneProps = {
  files: ChangedFileItem[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  validationLabel: string;
  validationTone: PreviewValidationTone;
  fileHint: string;
  impactSummary: string;
  impactObjects: string[];
  riskFlags: string[];
};

function validationToneClass(tone: PreviewValidationTone): string {
  if (tone === "valid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "invalid") return "border-red-200 bg-red-50 text-red-700";
  return "border-[#DDE3EE] bg-[#F8FAFC] text-[#5F6B82]";
}

function fileChipClass(selected: boolean): string {
  if (selected) return "border-[#C7D2FE] bg-[#E9EDFF] text-[#28397A]";
  return "border-[#DDE3EE] bg-white text-[#1F2937] hover:bg-[#F8FAFC]";
}

function changeTypeClass(changeType: ChangedFileItem["changeType"]): string {
  if (changeType === "A") return "text-emerald-700";
  if (changeType === "D") return "text-red-700";
  return "text-[#4F46E5]";
}

export function ChangePreviewPane({
  files,
  selectedPath,
  onSelectPath,
  validationLabel,
  validationTone,
  fileHint,
  impactSummary,
  impactObjects,
  riskFlags,
}: ChangePreviewPaneProps) {
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 rounded-[24px] border border-[#DDE3EE] bg-white p-6 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
      <div className="rounded-2xl border border-[#EEF2F8] bg-[#F8FAFC] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Changed files</p>
          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${validationToneClass(validationTone)}`}>
            {validationLabel}
          </span>
        </div>

        <div className="mt-4 max-h-52 space-y-2 overflow-auto pr-1">
          {files.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#DDE3EE] bg-white px-3 py-4 text-center text-xs text-[#94A0B8]">
              No changed files yet.
            </p>
          ) : (
            files.map((file) => {
              const selected = selectedPath === file.path;
              return (
                <button
                  key={`${file.changeType}:${file.path}`}
                  type="button"
                  onClick={() => onSelectPath(file.path)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs ${fileChipClass(selected)}`}
                >
                  <span className={`w-4 text-[11px] font-semibold ${changeTypeClass(file.changeType)}`}>{file.changeType}</span>
                  <span className="truncate">{file.path}</span>
                </button>
              );
            })
          )}
        </div>

        <p className="mt-3 text-xs text-[#94A0B8]">{fileHint}</p>
      </div>

      <div className="rounded-2xl border border-[#EEF2F8] bg-white p-4">
        <p className="text-sm font-semibold text-[#1F2937]">Impact</p>
        <p className="mt-1 text-xs text-[#5F6B82]">{impactSummary}</p>
        {riskFlags.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {riskFlags.map((flag) => (
              <span key={flag} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                {flag}
              </span>
            ))}
          </div>
        ) : null}
        {impactObjects.length ? (
          <div className="mt-3 max-h-28 space-y-1 overflow-auto text-xs text-[#5F6B82]">
            {impactObjects.map((item) => (
              <p key={item} className="rounded-lg border border-[#EEF2F8] bg-[#F8FAFC] px-2 py-1">
                {item}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#94A0B8]">No impact entries yet.</p>
        )}
      </div>
    </section>
  );
}
