export const MEMORY_LAYERS = [
  "soul",
  "project",
  "session",
  "episodic",
  "semantic",
  "procedural",
] as const;

export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

export const SOURCE_TYPES = ["user", "agent", "system", "migration"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface MemoryRecord {
  id: string;
  layer: MemoryLayer;
  agentId: string;
  sessionId: string | null;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  importance: number;
  accessCount: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  lastAccessed: string;
  expiresAt: string | null;
  isArchived: boolean;
  sourceType: SourceType | null;
  parentId: string | null;
}

export interface EncodeInput {
  content: string;
  layer: MemoryLayer;
  agentId?: string;
  sessionId?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  sourceType?: SourceType;
  parentId?: string;
  summary?: string;
}

export interface RecallQuery {
  query: string;
  layers?: MemoryLayer[];
  agentId?: string;
  sessionId?: string;
  limit?: number;
  minImportance?: number;
  timeRange?: {
    after?: string;
    before?: string;
  };
  includeArchived?: boolean;
}

export interface RankedMemory {
  record: MemoryRecord;
  score: number;
  vectorScore: number;
  bm25Score: number;
  recencyScore: number;
}

export interface ConsolidateOptions {
  layers?: MemoryLayer[];
  agentId?: string;
  dryRun?: boolean;
}

export interface ConsolidateResult {
  merged: number;
  archived: number;
  deleted: number;
}

export interface ForgetCriteria {
  ids?: string[];
  layer?: MemoryLayer;
  agentId?: string;
  olderThan?: string;
  maxImportance?: number;
  archive?: boolean;
}

export interface MemoryStats {
  total: number;
  byLayer: Record<MemoryLayer, number>;
  byAgent: Record<string, number>;
  archived: number;
  dbSizeBytes: number;
}
