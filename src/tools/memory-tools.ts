import { Type } from "@sinclair/typebox";
import type { MemoryEngine } from "../memory/engine.js";
import type { MemoryLayer } from "../memory/types.js";
import { MEMORY_LAYERS } from "../memory/types.js";

export function createMemoryTools(engine: MemoryEngine) {
  return {
    imprint_remember: {
      name: "imprint_remember",
      label: "Imprint Remember",
      description:
        "Store a memory in the specified layer. Layers: soul (identity/personality), project (workspace context), session (current conversation), episodic (past events), semantic (facts/knowledge), procedural (how-to/workflows). Automatically deduplicates similar content.",
      parameters: Type.Object({
        content: Type.String({ description: "The memory content to store" }),
        layer: Type.Unsafe<MemoryLayer>({
          type: "string",
          enum: [...MEMORY_LAYERS],
          description: "Memory layer: soul, project, session, episodic, semantic, procedural",
        }),
        importance: Type.Optional(
          Type.Number({
            description: "Importance 0-1 (default varies by layer)",
            minimum: 0,
            maximum: 1,
          }),
        ),
        tags: Type.Optional(
          Type.Array(Type.String(), {
            description: "Tags for categorization",
          }),
        ),
        sessionId: Type.Optional(
          Type.String({ description: "Session ID (required for session layer)" }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: {
          content: string;
          layer: MemoryLayer;
          importance?: number;
          tags?: string[];
          sessionId?: string;
        },
      ) {
        try {
          const record = await engine.encode({
            content: params.content,
            layer: params.layer,
            importance: params.importance,
            sessionId: params.sessionId,
            metadata: params.tags ? { tags: params.tags } : {},
            sourceType: "agent",
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `Stored memory [${record.layer}]: "${record.content.slice(0, 100)}${record.content.length > 100 ? "..." : ""}" (id: ${record.id}, importance: ${record.importance})`,
              },
            ],
            details: {
              id: record.id,
              layer: record.layer,
              importance: record.importance,
              isNew: record.accessCount === 0,
            },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error storing memory: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    },

    imprint_recall: {
      name: "imprint_recall",
      label: "Imprint Recall",
      description:
        "Search memories using hybrid semantic + keyword search. Returns ranked results with composite scoring (similarity + recency + importance). Use before answering questions about prior work, preferences, decisions, or context.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        layers: Type.Optional(
          Type.Array(
            Type.Unsafe<MemoryLayer>({
              type: "string",
              enum: [...MEMORY_LAYERS],
            }),
            { description: "Filter by memory layers" },
          ),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Max results (default: 10)", minimum: 1, maximum: 50 }),
        ),
        minImportance: Type.Optional(
          Type.Number({ description: "Minimum importance threshold", minimum: 0, maximum: 1 }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: {
          query: string;
          layers?: MemoryLayer[];
          limit?: number;
          minImportance?: number;
        },
      ) {
        try {
          const results = await engine.recall({
            query: params.query,
            layers: params.layers,
            limit: params.limit,
            minImportance: params.minImportance,
          });

          if (results.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No relevant memories found." }],
              details: { count: 0 },
            };
          }

          const text = results
            .map(
              (r, i) =>
                `${i + 1}. [${r.record.layer}] ${r.record.content.slice(0, 200)} (score: ${(r.score * 100).toFixed(0)}%, importance: ${r.record.importance})`,
            )
            .join("\n\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${results.length} memories:\n\n${text}`,
              },
            ],
            details: {
              count: results.length,
              results: results.map((r) => ({
                id: r.record.id,
                layer: r.record.layer,
                content: r.record.content,
                score: r.score,
                importance: r.record.importance,
              })),
            },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error recalling memories: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    },

    imprint_forget: {
      name: "imprint_forget",
      label: "Imprint Forget",
      description:
        "Remove or archive memories by ID or criteria. Use archive=true to soft-delete (recoverable).",
      parameters: Type.Object({
        ids: Type.Optional(
          Type.Array(Type.String(), { description: "Specific memory IDs to forget" }),
        ),
        layer: Type.Optional(
          Type.Unsafe<MemoryLayer>({
            type: "string",
            enum: [...MEMORY_LAYERS],
            description: "Forget all memories in this layer",
          }),
        ),
        maxImportance: Type.Optional(
          Type.Number({
            description: "Forget memories with importance <= this threshold",
          }),
        ),
        archive: Type.Optional(
          Type.Boolean({ description: "Archive instead of permanently delete (default: true)" }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: {
          ids?: string[];
          layer?: MemoryLayer;
          maxImportance?: number;
          archive?: boolean;
        },
      ) {
        const count = engine.forget({
          ids: params.ids,
          layer: params.layer,
          maxImportance: params.maxImportance,
          archive: params.archive ?? true,
        });

        const action = (params.archive ?? true) ? "archived" : "deleted";
        return {
          content: [
            { type: "text" as const, text: `${count} memories ${action}.` },
          ],
          details: { count, action },
        };
      },
    },

    imprint_update: {
      name: "imprint_update",
      label: "Imprint Update",
      description: "Update an existing memory's content, importance, or metadata.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory ID to update" }),
        content: Type.Optional(Type.String({ description: "New content" })),
        importance: Type.Optional(
          Type.Number({ description: "New importance 0-1", minimum: 0, maximum: 1 }),
        ),
        summary: Type.Optional(Type.String({ description: "Distilled summary" })),
      }),
      async execute(
        _toolCallId: string,
        params: {
          id: string;
          content?: string;
          importance?: number;
          summary?: string;
        },
      ) {
        const record = await engine.update(params.id, {
          content: params.content,
          importance: params.importance,
          summary: params.summary,
        });

        if (!record) {
          return {
            content: [{ type: "text" as const, text: `Memory ${params.id} not found.` }],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Updated memory ${record.id} [${record.layer}].`,
            },
          ],
          details: { id: record.id, layer: record.layer },
        };
      },
    },

    imprint_soul_get: {
      name: "imprint_soul_get",
      label: "Imprint Soul Get",
      description:
        "Read the current agent's soul/identity memories. Soul memories define personality, values, and communication style.",
      parameters: Type.Object({
        agentId: Type.Optional(
          Type.String({ description: "Agent ID (defaults to current)" }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: { agentId?: string },
      ) {
        const records = engine.getByLayer("soul", params.agentId);

        if (records.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No soul memories found. Use imprint_soul_set to define your identity." },
            ],
          };
        }

        const text = records
          .map((r) => `- ${r.content}`)
          .join("\n");

        return {
          content: [{ type: "text" as const, text: `Soul identity:\n${text}` }],
          details: { count: records.length, records },
        };
      },
    },

    imprint_soul_set: {
      name: "imprint_soul_set",
      label: "Imprint Soul Set",
      description:
        "Set or update agent soul/identity. Stores personality, values, and communication style as high-importance soul memories.",
      parameters: Type.Object({
        identity: Type.String({
          description: "Core identity description (who am I, what is my role)",
        }),
        values: Type.Optional(
          Type.String({ description: "Core values and priorities" }),
        ),
        style: Type.Optional(
          Type.String({ description: "Communication style preferences" }),
        ),
        agentId: Type.Optional(Type.String({ description: "Agent ID" })),
      }),
      async execute(
        _toolCallId: string,
        params: {
          identity: string;
          values?: string;
          style?: string;
          agentId?: string;
        },
      ) {
        const stored: string[] = [];

        const identity = await engine.encode({
          content: params.identity,
          layer: "soul",
          importance: 0.95,
          agentId: params.agentId,
          metadata: { type: "identity" },
          sourceType: "agent",
        });
        stored.push(identity.id);

        if (params.values) {
          const values = await engine.encode({
            content: params.values,
            layer: "soul",
            importance: 0.9,
            agentId: params.agentId,
            metadata: { type: "values" },
            sourceType: "agent",
          });
          stored.push(values.id);
        }

        if (params.style) {
          const style = await engine.encode({
            content: params.style,
            layer: "soul",
            importance: 0.85,
            agentId: params.agentId,
            metadata: { type: "style" },
            sourceType: "agent",
          });
          stored.push(style.id);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Soul identity set (${stored.length} memories stored).`,
            },
          ],
          details: { ids: stored },
        };
      },
    },
  };
}
