import { z } from "zod";

export const scoringConfigSchema = z.object({
  similarity: z.number().min(0).max(1).default(0.5),
  recency: z.number().min(0).max(1).default(0.3),
  importance: z.number().min(0).max(1).default(0.2),
  halfLifeDays: z.number().min(1).default(30),
});

export const consolidationConfigSchema = z.object({
  intervalMinutes: z.number().min(5).default(30),
  mergeThreshold: z.number().min(0.5).max(1).default(0.92),
  archiveAfterDays: z.number().min(1).default(90),
});

export const cacheConfigSchema = z.object({
  maxEntries: z.number().min(100).default(1000),
});

export const redisConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default("redis://localhost:6379"),
});

export const imprintConfigSchema = z.object({
  dataDir: z.string().default(".imprint"),
  embeddingModel: z.string().default("Xenova/all-MiniLM-L6-v2"),
  redis: redisConfigSchema.default({}),
  scoring: scoringConfigSchema.default({}),
  consolidation: consolidationConfigSchema.default({}),
  cache: cacheConfigSchema.default({}),
  autoCapture: z.boolean().default(false),
  autoRecall: z.boolean().default(true),
});

export type ImprintConfig = z.infer<typeof imprintConfigSchema>;
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type ConsolidationConfig = z.infer<typeof consolidationConfigSchema>;
export type CacheConfig = z.infer<typeof cacheConfigSchema>;
export type RedisConfig = z.infer<typeof redisConfigSchema>;
