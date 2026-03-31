export interface MarkdownSection {
  heading: string;
  content: string;
  level: number;
}

/**
 * Parse a Markdown file into sections split by headings.
 */
export function parseMarkdownSections(text: string): MarkdownSection[] {
  const lines = text.split("\n");
  const sections: MarkdownSection[] = [];
  let currentHeading = "";
  let currentLevel = 0;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section if it has content
      if (currentContent.length > 0 || currentHeading) {
        const content = currentContent.join("\n").trim();
        if (content) {
          sections.push({
            heading: currentHeading,
            content,
            level: currentLevel,
          });
        }
      }

      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  const lastContent = currentContent.join("\n").trim();
  if (lastContent) {
    sections.push({
      heading: currentHeading,
      content: lastContent,
      level: currentLevel,
    });
  }

  return sections;
}

/**
 * Estimate importance based on content heuristics.
 */
export function estimateImportance(content: string): number {
  let score = 0.5;

  // Action items and decisions are more important
  if (/\b(todo|action|decide|critical|important|must|blocker)\b/i.test(content)) {
    score += 0.2;
  }

  // Preferences and rules
  if (/\b(always|never|prefer|rule|convention|standard)\b/i.test(content)) {
    score += 0.15;
  }

  // Code references
  if (/```|`[^`]+`/.test(content)) {
    score += 0.05;
  }

  // Links
  if (/https?:\/\//.test(content)) {
    score += 0.05;
  }

  return Math.min(score, 1.0);
}

/**
 * Format a memory record as Markdown for export.
 */
export function memoryToMarkdown(record: {
  content: string;
  layer: string;
  importance: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`layer: ${record.layer}`);
  lines.push(`importance: ${record.importance}`);
  lines.push(`created: ${record.createdAt}`);

  const tags = record.metadata.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    lines.push(`tags: [${tags.join(", ")}]`);
  }

  lines.push("---");
  lines.push("");
  lines.push(record.content);

  return lines.join("\n");
}
