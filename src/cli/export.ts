import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { MemoryEngine } from "../memory/engine.js";
import type { MemoryLayer } from "../memory/types.js";
import { MEMORY_LAYERS } from "../memory/types.js";
import { memoryToMarkdown } from "../utils/markdown.js";

export interface ExportOptions {
  outputDir: string;
  layers?: MemoryLayer[];
  agentId?: string;
  includeArchived?: boolean;
}

export interface ExportResult {
  filesCreated: number;
  recordsExported: number;
}

export function exportMemories(
  engine: MemoryEngine,
  options: ExportOptions,
): ExportResult {
  mkdirSync(options.outputDir, { recursive: true });

  const layers = options.layers ?? [...MEMORY_LAYERS];
  let totalRecords = 0;
  let filesCreated = 0;

  for (const layer of layers) {
    const records = engine.getByLayer(layer, options.agentId);
    if (records.length === 0) continue;

    const sections = records.map((r) =>
      memoryToMarkdown({
        content: r.content,
        layer: r.layer,
        importance: r.importance,
        metadata: r.metadata,
        createdAt: r.createdAt,
      }),
    );

    const filePath = resolve(options.outputDir, `${layer}.md`);
    const header = `# Imprint Export: ${layer}\n\nExported: ${new Date().toISOString()}\nRecords: ${records.length}\n\n---\n\n`;
    writeFileSync(filePath, header + sections.join("\n\n---\n\n"));

    totalRecords += records.length;
    filesCreated++;
  }

  return {
    filesCreated,
    recordsExported: totalRecords,
  };
}
