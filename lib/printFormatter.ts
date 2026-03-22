/**
 * Cleans LLM output for display and print.
 * - Preserves mermaid diagram fences.
 * - Preserves bold (**text**), bullet points (-), and numbered lists
 *   so react-markdown can render them properly.
 * - Strips only true noise: inline backticks, non-mermaid triple-backtick
 *   fences, horizontal rules, and excess blank lines.
 */
export function formatForPrint(text: string): string {
  // Stash mermaid blocks before any stripping
  const mermaidBlocks: string[] = [];
  let processed = text.replace(
    /```mermaid\n([\s\S]*?)```/g,
    (_match, code: string) => {
      const idx = mermaidBlocks.length;
      mermaidBlocks.push(code.trim());
      return `\x00MERMAID_${idx}\x00`;
    }
  );

  processed = processed
    // Strip remaining triple-backtick fences (non-mermaid code blocks)
    .replace(/```[\s\S]*?```/g, "")
    // Strip inline code backticks (keep the text content)
    .replace(/`([^`]+)`/g, "$1")
    // Strip horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // Collapse 3+ consecutive blank lines to 1
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Restore mermaid fences
  processed = processed.replace(/\x00MERMAID_(\d+)\x00/g, (_m, idx) => {
    return `\`\`\`mermaid\n${mermaidBlocks[parseInt(idx, 10)]}\n\`\`\``;
  });

  return processed;
}
