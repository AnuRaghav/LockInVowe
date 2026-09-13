import { Fragment, type ReactNode } from "react";

import { parseMarkdown, type BlockNode, type InlineNode } from "@/lib/chat/markdown";

/**
 * Sam's answers, rendered as elements - never as HTML, so nothing the model
 * writes can become markup. Spacing is set here rather than by a prose plugin
 * because these blocks share the column with figures and, later, charts.
 */

function inline(nodes: InlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.value}</Fragment>;
      case "code":
        return (
          <code key={index} className="rounded bg-surface-strong px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
            {node.value}
          </code>
        );
      case "strong":
        return (
          <strong key={index} className="font-semibold text-foreground">
            {inline(node.children)}
          </strong>
        );
      case "em":
        return (
          <em key={index} className="italic">
            {inline(node.children)}
          </em>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline underline-offset-4 hover:text-accent-strong"
          >
            {inline(node.children)}
          </a>
        );
    }
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-[20px] font-semibold tracking-tight",
  2: "text-[17px] font-semibold tracking-tight",
  3: "text-[15px] font-semibold",
};

function block(node: BlockNode, key: number): ReactNode {
  switch (node.type) {
    case "heading": {
      const Tag = (`h${Math.min(node.level + 1, 6)}`) as "h2";
      return (
        <Tag key={key} className={`mt-6 mb-2 first:mt-0 text-foreground ${HEADING_CLASS[node.level] ?? HEADING_CLASS[3]}`}>
          {inline(node.children)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="my-3 first:mt-0 last:mb-0">
          {inline(node.children)}
        </p>
      );
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className={`my-3 flex flex-col gap-1.5 pl-5 first:mt-0 last:mb-0 ${
            node.ordered ? "list-decimal" : "list-disc"
          } marker:text-muted-2`}
        >
          {node.items.map((item, index) => (
            <li key={index} className="pl-1">
              {inline(item)}
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="my-4 border-l-2 border-border-strong pl-4 text-muted">
          {inline(node.children)}
        </blockquote>
      );
    case "code":
      return (
        <pre
          key={key}
          className="my-4 overflow-x-auto rounded-xl border border-border bg-black/30 p-4 font-mono text-[13px] leading-relaxed text-foreground"
        >
          <code>{node.value}</code>
        </pre>
      );
    case "table":
      return (
        <div key={key} className="my-4 overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-[14px]">
            <thead>
              <tr>
                {node.header.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-border-strong px-3 py-2 text-left text-[12px] font-medium uppercase tracking-[0.08em] text-muted-2"
                  >
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-b border-border px-3 py-2 tabular-nums">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr key={key} className="my-6 border-border" />;
  }
}

export function Markdown({ source }: { source: string }) {
  return <>{parseMarkdown(source).map(block)}</>;
}
