"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function MarkdownPreview(props: { markdown: string; emptyText?: string }) {
  return (
    <div className="space-y-3 text-sm leading-6 text-zinc-900">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({ node: _node, ...p }) => ((void _node), <h1 {...p} className="text-xl font-semibold text-zinc-950" />),
          h2: ({ node: _node, ...p }) => ((void _node), <h2 {...p} className="text-lg font-semibold text-zinc-950" />),
          h3: ({ node: _node, ...p }) => ((void _node), <h3 {...p} className="text-base font-semibold text-zinc-950" />),
          a: ({ node: _node, ...p }) =>
            ((void _node),
            (
              <a
                {...p}
                className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
                target={p.href?.startsWith("#") ? undefined : "_blank"}
                rel={p.href?.startsWith("#") ? undefined : "noreferrer"}
              />
            )),
          ul: ({ node: _node, ...p }) => ((void _node), <ul {...p} className="list-disc space-y-1 pl-5" />),
          ol: ({ node: _node, ...p }) => ((void _node), <ol {...p} className="list-decimal space-y-1 pl-5" />),
          li: ({ node: _node, ...p }) => ((void _node), <li {...p} className="break-words" />),
          blockquote: ({ node: _node, ...p }) =>
            ((void _node), <blockquote {...p} className="border-l-4 border-zinc-200 pl-3 text-zinc-700" />),
          hr: ({ node: _node, ...p }) => ((void _node), <hr {...p} className="border-zinc-200" />),
          code: ({
            node: _node,
            className,
            ...p
          }: React.ComponentPropsWithoutRef<"code"> & { inline?: boolean; node?: unknown }) =>
            ((void _node),
            <code
              {...p}
              className={[className, "rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] text-zinc-900"]
                .filter(Boolean)
                .join(" ")}
            />),
          pre: ({ node: _node, ...p }) =>
            ((void _node),
            <pre
              {...p}
              className="overflow-auto rounded-xl bg-zinc-950 p-3 text-[12px] leading-5 text-zinc-50 [&_code]:rounded-none [&_code]:bg-transparent [&_code]:px-0 [&_code]:py-0 [&_code]:text-inherit"
            />),
          table: ({ node: _node, ...p }) =>
            ((void _node),
            (
              <div className="overflow-auto rounded-xl border border-zinc-200">
                <table {...p} className="w-full border-collapse text-sm" />
              </div>
            )),
          th: ({ node: _node, ...p }) =>
            ((void _node), <th {...p} className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left" />),
          td: ({ node: _node, ...p }) =>
            ((void _node), <td {...p} className="border-b border-zinc-100 px-3 py-2 align-top" />),
        }}
      >
        {props.markdown || props.emptyText || "(empty)"}
      </ReactMarkdown>
    </div>
  );
}
