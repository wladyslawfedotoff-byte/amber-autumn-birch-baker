import { useMemo, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/assistant/markdown";
import { cn } from "@/lib/cn";

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "br":
        return <br key={i} />;
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            {inline(node.children)}
          </strong>
        );
      case "em":
        return <em key={i}>{inline(node.children)}</em>;
      case "code":
        return (
          <code key={i} className="rounded border border-line bg-elevated px-1 font-mono text-[0.875em]">
            {node.text}
          </code>
        );
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-ink underline underline-offset-2">
            {inline(node.children)}
          </a>
        );
    }
  });
}

/** Assistant answer with simple markdown; React escapes all text, no raw HTML. */
export function AssistMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn("space-y-2 text-body break-words", className)}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "p":
            return <p key={i}>{inline(block.children)}</p>;
          case "heading":
            return (
              <p key={i} className="font-semibold">
                {inline(block.children)}
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted">
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} start={block.start} className="list-decimal space-y-1 pl-5 marker:text-muted">
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}
