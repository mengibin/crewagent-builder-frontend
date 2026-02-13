"use client";

import Image from "next/image";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { SquirrelMascot } from "@/components/ai/squirrel-mascot";

export type ConversationRole = "user" | "assistant" | "system";
export type ConversationStatus = "waiting" | "running" | "failed" | "applied";
export type ConversationMessageKind = "chat" | "thinking" | "function_call" | "tool_result";
export type ConversationRuntimeToolStatus = "running" | "ok" | "failed";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  content: string;
  kind?: ConversationMessageKind;
};

export type ConversationRuntimeIndicator = {
  streaming: boolean;
  phaseText?: string | null;
  thinkingText?: string | null;
  toolName?: string | null;
  toolStatus?: ConversationRuntimeToolStatus | null;
};

type RuntimeStatusView = {
  pillClassName: string;
  label: string;
  detail: string | null;
  mascotMode: "idle" | "thinking" | "working";
  icon: "dot" | "brain" | "tool";
  spinning: boolean;
};

type ConversationPaneProps = {
  messages: ConversationMessage[];
  status: ConversationStatus;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  canRetry: boolean;
  busy: boolean;
  contextBudgetHint: string;
  errorMessage?: string | null;
  runtimeIndicator?: ConversationRuntimeIndicator;
};

function statusText(status: ConversationStatus): string {
  if (status === "running") return "Status: generating suggestion";
  if (status === "failed") return "Status: last request failed";
  if (status === "applied") return "Status: applied";
  return "Status: waiting for your next prompt";
}

function labelForMessage(message: ConversationMessage): string {
  if (message.kind === "thinking") return "Thinking";
  if (message.kind === "function_call") return "Function call";
  if (message.kind === "tool_result") return "Tool result";
  if (message.role === "user") return "You";
  if (message.role === "system") return "System";
  return "Assistant";
}

function bubbleClass(message: ConversationMessage): string {
  if (message.kind === "thinking") return "border-[#FDE68A] bg-[#FFF7DB] text-[#78350F]";
  if (message.kind === "function_call") return "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]";
  if (message.kind === "tool_result") return "border-[#CBD5E1] bg-[#F8FAFC] text-[#334155]";
  if (message.role === "user") return "border-[#C7D2FE] bg-[#EEF2FF] text-[#27325D]";
  if (message.role === "system") return "border-[#F3E8FF] bg-[#FAF5FF] text-[#5B357F]";
  return "border-[#DDE3EE] bg-white text-[#1F2937]";
}

function toolStatusLabel(status: ConversationRuntimeToolStatus | null | undefined): string {
  if (status === "running") return "running";
  if (status === "ok") return "completed";
  if (status === "failed") return "failed";
  return "";
}

function resolveRuntimeStatusView(indicator?: ConversationRuntimeIndicator): RuntimeStatusView | null {
  if (!indicator) return null;

  const toolName = (indicator.toolName ?? "").trim();
  const thinkingText = (indicator.thinkingText ?? "").trim();
  const phaseText = (indicator.phaseText ?? "").trim();
  const toolStatus = toolStatusLabel(indicator.toolStatus);

  if (toolName) {
    if (toolStatus === "running") {
      return {
        pillClassName: "ca-runtime-pill ca-runtime-pill-tool running",
        label: `Running ${toolName}...`,
        detail: null,
        mascotMode: "working",
        icon: "tool",
        spinning: true,
      };
    }
    if (toolStatus === "failed") {
      return {
        pillClassName: "ca-runtime-pill ca-runtime-pill-tool",
        label: `Failed ${toolName}`,
        detail: null,
        mascotMode: "idle",
        icon: "tool",
        spinning: false,
      };
    }
    return {
      pillClassName: "ca-runtime-pill ca-runtime-pill-tool",
      label: `Completed ${toolName}`,
      detail: null,
      mascotMode: "idle",
      icon: "tool",
      spinning: false,
    };
  }

  if (thinkingText) {
    return {
      pillClassName: "ca-runtime-pill ca-runtime-pill-thinking",
      label: "Thinking...",
      detail: thinkingText,
      mascotMode: "thinking",
      icon: "brain",
      spinning: false,
    };
  }

  if (phaseText) {
    return {
      pillClassName: "ca-runtime-pill ca-runtime-pill-streaming",
      label: phaseText,
      detail: null,
      mascotMode: indicator.streaming ? "thinking" : "idle",
      icon: "dot",
      spinning: false,
    };
  }

  if (indicator.streaming) {
    return {
      pillClassName: "ca-runtime-pill ca-runtime-pill-streaming",
      label: "Streaming response...",
      detail: null,
      mascotMode: "thinking",
      icon: "dot",
      spinning: false,
    };
  }

  return null;
}

function Avatar({ role }: { role: ConversationRole }) {
  if (role === "assistant") {
    return (
      <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-[#DDE3EE] bg-white p-1">
        <Image src="/favicon.png" alt="Assistant" width={20} height={20} className="h-full w-full object-contain" />
      </span>
    );
  }
  if (role === "user") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#BFDBFE] bg-[#EFF6FF] text-[10px] font-semibold text-[#1E40AF]">
        YOU
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#DDE3EE] bg-[#F8FAFC] text-[10px] font-semibold text-[#5F6B82]">
      SYS
    </span>
  );
}

function MarkdownMessage({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        p: ({ node: _node, ...props }) => ((void _node), <p {...props} className="my-1 whitespace-pre-wrap break-words" />),
        ul: ({ node: _node, ...props }) => ((void _node), <ul {...props} className="my-1 list-disc space-y-1 pl-5" />),
        ol: ({ node: _node, ...props }) => ((void _node), <ol {...props} className="my-1 list-decimal space-y-1 pl-5" />),
        li: ({ node: _node, ...props }) => ((void _node), <li {...props} className="break-words" />),
        a: ({ node: _node, ...props }) =>
          ((void _node),
          (
            <a
              {...props}
              className="underline underline-offset-2"
              target={props.href?.startsWith("#") ? undefined : "_blank"}
              rel={props.href?.startsWith("#") ? undefined : "noreferrer"}
            />
          )),
        code: ({
          node: _node,
          inline,
          className,
          ...props
        }: React.ComponentPropsWithoutRef<"code"> & { inline?: boolean; node?: unknown }) =>
          ((void _node),
          inline ? (
            <code {...props} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px]" />
          ) : (
            <code {...props} className={`${className ?? ""} font-mono text-[11px]`} />
          )),
        pre: ({ node: _node, ...props }) =>
          ((void _node), <pre {...props} className="my-2 overflow-auto rounded-lg bg-black/80 p-2 text-[11px] text-white" />),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

export function ConversationPane({
  messages,
  status,
  composerValue,
  onComposerChange,
  onSend,
  onRetry,
  canRetry,
  busy,
  contextBudgetHint,
  errorMessage,
  runtimeIndicator,
}: ConversationPaneProps) {
  const runtimeView = resolveRuntimeStatusView(runtimeIndicator);
  const showRuntimeIndicator = Boolean(runtimeView);
  const conversationEndRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, showRuntimeIndicator, runtimeView?.label, runtimeView?.detail]);

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Process") return;
    if (event.nativeEvent.isComposing) return;
    if (busy || !composerValue.trim()) return;

    event.preventDefault();
    onSend();
  };

  return (
    <div className="flex h-full flex-col">
      <section className="relative flex min-h-0 flex-1 flex-col rounded-[24px] border border-[#DDE3EE] bg-white p-6 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Conversation</p>
          <span className="rounded-full border border-[#DDE3EE] bg-[#F8FAFC] px-3 py-1 text-[11px] font-semibold text-[#5F6B82]">
            {statusText(status)}
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto rounded-2xl border border-[#EEF2F8] bg-[#F8FAFC] p-3">
          {messages.length === 0 && !showRuntimeIndicator ? (
            <p className="text-xs text-[#94A0B8]">Conversation stream is empty.</p>
          ) : null}

          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`flex max-w-[88%] items-start gap-2 rounded-2xl border px-3 py-2 text-xs leading-5 ${isUser ? "flex-row-reverse" : ""} ${bubbleClass(message)}`}
                >
                  <Avatar role={message.role} />
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#94A0B8]">
                      {labelForMessage(message)}
                    </p>
                    <MarkdownMessage markdown={message.content} />
                  </div>
                </div>
              </div>
            );
          })}

          {showRuntimeIndicator ? (
            <div className="flex justify-start">
              <div className="ca-runtime-strip">
                <div className="ca-runtime-avatar">
                  <SquirrelMascot mode={runtimeView?.mascotMode ?? "idle"} size={28} />
                </div>
                <div className="ca-runtime-body">
                  <div className="ca-runtime-row">
                    <span className={runtimeView?.pillClassName}>
                      {runtimeView?.icon === "dot" ? <span className="ca-runtime-pill-dot ca-runtime-pulse" /> : null}
                      {runtimeView?.icon === "brain" ? <span className="ca-runtime-pill-icon">🧠</span> : null}
                      {runtimeView?.icon === "tool" ? (
                        <span className={`ca-runtime-pill-icon ${runtimeView?.spinning ? "ca-runtime-spin" : ""}`}>⚙︎</span>
                      ) : null}
                      {runtimeView?.label}
                    </span>
                  </div>
                  {(runtimeView?.detail ?? "").trim() ? (
                    <p className="ca-runtime-detail">{runtimeView?.detail}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div ref={conversationEndRef} />
        </div>

        {errorMessage ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{errorMessage}</div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-[#DDE3EE] bg-white p-3">
          <textarea
            value={composerValue}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={`Refine draft...\n- keep agentId unchanged\n- mention data contract in Instructions`}
            rows={4}
            disabled={busy}
            className="w-full resize-none rounded-xl border border-[#DDE3EE] bg-[#F8FAFC] px-3 py-2 text-xs text-[#1F2937] outline-none focus:border-[#C7D2FE] disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                disabled={!canRetry || busy}
                className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-[11px] font-semibold text-[#5F6B82] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry last request
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={busy || !composerValue.trim()}
                className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-[11px] font-semibold text-[#4F46E5] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send and re-validate
              </button>
            </div>
            <p className="text-[11px] text-[#94A0B8]">{contextBudgetHint}</p>
          </div>
        </div>
      </section>

    </div>
  );
}
