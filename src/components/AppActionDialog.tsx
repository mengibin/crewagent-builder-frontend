"use client";

import { type ReactNode } from "react";

export type AppActionDialogTone = "default" | "danger";

type AppActionDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  tone?: AppActionDialogTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AppActionDialog(props: AppActionDialogProps) {
  const {
    open,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    showCancel = true,
    tone = "default",
    busy = false,
    onConfirm,
    onCancel,
  } = props;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div
        className="absolute inset-0 bg-zinc-950/30"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight text-zinc-900">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            Close
          </button>
        </div>

        <div className="mt-4 whitespace-pre-wrap break-words text-sm text-zinc-700">{message}</div>

        <div className="mt-6 flex items-center justify-end gap-3">
          {showCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            >
              {cancelLabel}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              tone === "danger"
                ? "rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
                : "rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

