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

type DiffOp = {
  type: "equal" | "delete" | "insert";
  text: string;
};

type SideKind = "context" | "removed" | "added" | "modified-removed" | "modified-added" | "empty";

type DiffSideRow = {
  lineNumber: number | null;
  text: string;
  kind: SideKind;
};

type DiffRow = {
  left: DiffSideRow;
  right: DiffSideRow;
};

const MAX_DP_CELLS = 2_000_000;

function splitLines(value: string): string[] {
  if (!value) return [];
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function buildFallbackOps(beforeLines: string[], afterLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i += 1) {
    const beforeLine = beforeLines[i];
    const afterLine = afterLines[i];
    if (beforeLine === undefined) {
      ops.push({ type: "insert", text: afterLine });
      continue;
    }
    if (afterLine === undefined) {
      ops.push({ type: "delete", text: beforeLine });
      continue;
    }
    if (beforeLine === afterLine) {
      ops.push({ type: "equal", text: beforeLine });
      continue;
    }
    ops.push({ type: "delete", text: beforeLine });
    ops.push({ type: "insert", text: afterLine });
  }
  return ops;
}

function buildLineOps(beforeLines: string[], afterLines: string[]): DiffOp[] {
  const n = beforeLines.length;
  const m = afterLines.length;
  if ((n + 1) * (m + 1) > MAX_DP_CELLS) return buildFallbackOps(beforeLines, afterLines);

  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (beforeLines[i] === afterLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ type: "equal", text: beforeLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", text: beforeLines[i] });
      i += 1;
    } else {
      ops.push({ type: "insert", text: afterLines[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "delete", text: beforeLines[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "insert", text: afterLines[j] });
    j += 1;
  }
  return ops;
}

function buildDiffRows(before: string, after: string): DiffRow[] {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const ops = buildLineOps(beforeLines, afterLines);

  const rows: DiffRow[] = [];
  let beforeLineNumber = 1;
  let afterLineNumber = 1;
  let index = 0;

  while (index < ops.length) {
    const op = ops[index];
    if (op.type === "equal") {
      rows.push({
        left: { lineNumber: beforeLineNumber, text: op.text, kind: "context" },
        right: { lineNumber: afterLineNumber, text: op.text, kind: "context" },
      });
      beforeLineNumber += 1;
      afterLineNumber += 1;
      index += 1;
      continue;
    }

    if (op.type === "delete") {
      const removed: string[] = [];
      while (index < ops.length && ops[index].type === "delete") {
        removed.push(ops[index].text);
        index += 1;
      }
      const added: string[] = [];
      while (index < ops.length && ops[index].type === "insert") {
        added.push(ops[index].text);
        index += 1;
      }

      const size = Math.max(removed.length, added.length);
      for (let i = 0; i < size; i += 1) {
        const removedText = removed[i];
        const addedText = added[i];
        if (removedText !== undefined && addedText !== undefined) {
          rows.push({
            left: { lineNumber: beforeLineNumber, text: removedText, kind: "modified-removed" },
            right: { lineNumber: afterLineNumber, text: addedText, kind: "modified-added" },
          });
          beforeLineNumber += 1;
          afterLineNumber += 1;
        } else if (removedText !== undefined) {
          rows.push({
            left: { lineNumber: beforeLineNumber, text: removedText, kind: "removed" },
            right: { lineNumber: null, text: "", kind: "empty" },
          });
          beforeLineNumber += 1;
        } else if (addedText !== undefined) {
          rows.push({
            left: { lineNumber: null, text: "", kind: "empty" },
            right: { lineNumber: afterLineNumber, text: addedText, kind: "added" },
          });
          afterLineNumber += 1;
        }
      }
      continue;
    }

    rows.push({
      left: { lineNumber: null, text: "", kind: "empty" },
      right: { lineNumber: afterLineNumber, text: op.text, kind: "added" },
    });
    afterLineNumber += 1;
    index += 1;
  }

  return rows;
}

function sideCellClass(kind: SideKind): string {
  switch (kind) {
    case "added":
      return "bg-[#F0FDF4] text-[#1F5D3A]";
    case "removed":
      return "bg-[#FFF5F5] text-[#7A2433]";
    case "modified-added":
      return "bg-[#E8F7EE] text-[#1F5D3A]";
    case "modified-removed":
      return "bg-[#FDECEE] text-[#7A2433]";
    case "empty":
      return "bg-[#F6F8FC] text-[#9AA5BD]";
    case "context":
    default:
      return "bg-[#F9FBFF] text-[#3E4A61]";
  }
}

function lineNumberClass(kind: SideKind): string {
  if (kind === "added" || kind === "modified-added") return "bg-[#DCFCE7] text-[#2F855A]";
  if (kind === "removed" || kind === "modified-removed") return "bg-[#FEE2E2] text-[#C53030]";
  return "bg-[#EEF2F8] text-[#8C97AD]";
}

export function MarkdownDiffPanel({ diffModel, revisionConflictDetails = [] }: MarkdownDiffPanelProps) {
  const diffRows = diffModel ? buildDiffRows(diffModel.before || "", diffModel.after || "") : [];

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
        <div className="mt-3 overflow-hidden rounded-xl border border-[#DDE3EE] bg-[#F8FAFC] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <div className="grid grid-cols-2 border-b border-[#DDE3EE] bg-[#EEF3FF] text-[11px] font-semibold uppercase tracking-wide text-[#5F6B82]">
            <div className="border-r border-[#DDE3EE] px-3 py-2">Before</div>
            <div className="px-3 py-2">After</div>
          </div>
          {diffRows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[#94A0B8]">(empty)</div>
          ) : (
            <div>
              {diffRows.map((row, idx) => (
                <div key={`${idx}-${row.left.lineNumber ?? "n"}-${row.right.lineNumber ?? "n"}`} className="grid grid-cols-2 border-b border-[#E4EAF3] last:border-b-0">
                  <div className={`grid grid-cols-[56px_minmax(0,1fr)] border-r border-[#DDE3EE] ${sideCellClass(row.left.kind)}`}>
                    <div className={`border-r border-[#DDE3EE] px-2 py-1 text-right text-[11px] ${lineNumberClass(row.left.kind)}`}>
                      {row.left.lineNumber ?? ""}
                    </div>
                    <pre className="px-3 py-1 text-[12px] leading-5 whitespace-pre-wrap break-words font-mono">
                      {row.left.text || " "}
                    </pre>
                  </div>

                  <div className={`grid grid-cols-[56px_minmax(0,1fr)] ${sideCellClass(row.right.kind)}`}>
                    <div className={`border-r border-[#DDE3EE] px-2 py-1 text-right text-[11px] ${lineNumberClass(row.right.kind)}`}>
                      {row.right.lineNumber ?? ""}
                    </div>
                    <pre className="px-3 py-1 text-[12px] leading-5 whitespace-pre-wrap break-words font-mono">
                      {row.right.text || " "}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 border-t border-[#DDE3EE] bg-[#EEF3FF]">
            <div className="border-r border-[#DDE3EE] px-3 py-1 text-[10px] text-[#8190AB]">- deleted / old</div>
            <div className="px-3 py-1 text-[10px] text-[#8190AB]">+ added / new</div>
          </div>
        </div>
      )}
    </section>
  );
}
