"use client";

// Wave 37 (VERI Chat Intelligence Engine, PLATFORM_STRATEGY.md §18): shared
// between ThreadView.tsx (VERI Chat) and the VERI AI thread view -- the
// "nearly identical features, shared implementation" the user asked for.
// react-markdown was already an installed, unused dependency (^10.1.0)
// before this wave; every message everywhere rendered as plain text.
import ReactMarkdown from "react-markdown";
import { parseStructuredMessage } from "@/lib/structured-message";
import { StructuredMessageContent } from "@/components/chat/StructuredMessageContent";

export function MessageContent({ content }: { content: string }) {
  // Wave 151: if the content is structured JSON (summary/confirmation),
  // render it via the structured renderer; otherwise fall back to the
  // exact same ReactMarkdown block below. parseStructuredMessage returns
  // null for any non-structured input (incl. all existing plain-text
  // messages), so this is 100% backward compatible.
  const structured = parseStructuredMessage(content);
  if (structured) {
    return <StructuredMessageContent data={structured} />;
  }

  return (
    <div className="text-sm break-words [&_p]:whitespace-pre-wrap [&_p:not(:last-child)]:mb-2">
      <ReactMarkdown
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" />,
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className || "");
            return isBlock ? (
              <code className={`block whitespace-pre-wrap rounded-md bg-black/10 px-2 py-1.5 my-1 text-xs font-mono ${className ?? ""}`} {...props}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-black/10 px-1 py-0.5 text-xs font-mono" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="max-w-full overflow-x-auto">{children}</pre>,
          ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
