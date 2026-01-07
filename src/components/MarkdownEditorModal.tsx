"use client";

import { useEffect, useRef, useState } from "react";

import { MarkdownPreview } from "./MarkdownPreview";

export type MarkdownEditorModalProps = {
  title: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
  onClose: () => void;
};

export function MarkdownEditorModal(props: MarkdownEditorModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(props.value);

  const updateDraft = (next: string) => {
    setDraft(next);
    props.onChange(next);
  };

  const focusAndSelect = (start: number, end: number) => {
    const el = textareaRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      try {
        el.setSelectionRange(start, end);
      } catch {
        // ignore
      }
    });
  };

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const el = textareaRef.current;
    const value = draft ?? "";
    const selectionStart = el?.selectionStart ?? value.length;
    const selectionEnd = el?.selectionEnd ?? value.length;
    const hasSelection = selectionStart !== selectionEnd;
    const selected = value.slice(selectionStart, selectionEnd);
    const inner = hasSelection ? selected : placeholder;
    const insertText = `${before}${inner}${after}`;
    const next = `${value.slice(0, selectionStart)}${insertText}${value.slice(selectionEnd)}`;
    updateDraft(next);

    const cursorStart = selectionStart + before.length;
    const cursorEnd = cursorStart + inner.length;
    focusAndSelect(cursorStart, cursorEnd);
  };

  const insertAtCursor = (text: string, cursorOffsetFromStart?: number) => {
    const el = textareaRef.current;
    const value = draft ?? "";
    const selectionStart = el?.selectionStart ?? value.length;
    const selectionEnd = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`;
    updateDraft(next);

    const cursorPos =
      selectionStart + (typeof cursorOffsetFromStart === "number" ? cursorOffsetFromStart : text.length);
    focusAndSelect(cursorPos, cursorPos);
  };

  const insertLineToken = (token: string, cursorOffsetInToken?: number) => {
    const el = textareaRef.current;
    const value = draft ?? "";
    const selectionStart = el?.selectionStart ?? value.length;
    const prefix = selectionStart > 0 && value[selectionStart - 1] !== "\n" ? "\n" : "";
    const offset = prefix.length + (typeof cursorOffsetInToken === "number" ? cursorOffsetInToken : token.length);
    insertAtCursor(`${prefix}${token}`, offset);
  };

  const applyToolbarAction = (action: string) => {
    if (action === "bold") return wrapSelection("**", "**", "bold text");
    if (action === "italic") return wrapSelection("*", "*", "italic text");
    if (action === "code") return wrapSelection("`", "`", "code");
    if (action === "quote") return insertLineToken("> ", 2);
    if (action === "ul") return insertLineToken("- ", 2);
    if (action === "ol") return insertLineToken("1. ", 3);
    if (action === "h2") return insertLineToken("## ", 3);
    if (action === "hr") return insertLineToken("---\n", 3);
    if (action === "codeblock") return insertLineToken("```\n\n```\n", 4);

    if (action === "link") {
      const el = textareaRef.current;
      const value = draft ?? "";
      const selectionStart = el?.selectionStart ?? value.length;
      const selectionEnd = el?.selectionEnd ?? value.length;
      const selected = value.slice(selectionStart, selectionEnd);
      const text = selected || "link text";
      const url = "https://";
      const insertText = `[${text}](${url})`;
      const next = `${value.slice(0, selectionStart)}${insertText}${value.slice(selectionEnd)}`;
      updateDraft(next);

      const urlStart = selectionStart + 1 + text.length + 2;
      focusAndSelect(urlStart, urlStart + url.length);
      return;
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/30" onClick={props.onClose} />
      <div className="relative flex h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">{props.title}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">Edit left · Preview right · Esc to close</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Close
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
          <div className="flex flex-col border-b border-zinc-200 md:border-b-0 md:border-r">
            <div className="px-4 py-2 text-xs font-medium text-zinc-700">Editor</div>
            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 bg-white px-3 py-2">
              {[
                { id: "bold", label: "**B**", title: "Bold" },
                { id: "italic", label: "*I*", title: "Italic" },
                { id: "code", label: "`</>`", title: "Inline code" },
                { id: "codeblock", label: "```", title: "Code block" },
                { id: "link", label: "[]()", title: "Link" },
                { id: "ul", label: "- ", title: "Bullet list" },
                { id: "ol", label: "1.", title: "Numbered list" },
                { id: "quote", label: ">", title: "Quote" },
                { id: "h2", label: "##", title: "Heading" },
                { id: "hr", label: "---", title: "Divider" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyToolbarAction(item.id)}
                  title={item.title}
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => updateDraft(e.target.value)}
              placeholder={props.placeholder}
              className="min-h-0 flex-1 resize-none border-0 px-4 py-3 font-mono text-xs leading-6 text-zinc-900 outline-none"
              autoFocus
            />
          </div>
          <div className="flex flex-col overflow-hidden">
            <div className="px-4 py-2 text-xs font-medium text-zinc-700">Preview</div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              <MarkdownPreview markdown={draft} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
