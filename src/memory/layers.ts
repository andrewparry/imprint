import type { EncodeInput, MemoryLayer } from "./types.js";

interface LayerDefaults {
  defaultImportance: number;
  expiresAfterDays: number | null;
  requiresSessionId: boolean;
  maxPerAgent: number | null;
}

const LAYER_DEFAULTS: Record<MemoryLayer, LayerDefaults> = {
  soul: {
    defaultImportance: 0.9,
    expiresAfterDays: null,
    requiresSessionId: false,
    maxPerAgent: 10,
  },
  project: {
    defaultImportance: 0.7,
    expiresAfterDays: null,
    requiresSessionId: false,
    maxPerAgent: null,
  },
  session: {
    defaultImportance: 0.5,
    expiresAfterDays: 7,
    requiresSessionId: true,
    maxPerAgent: null,
  },
  episodic: {
    defaultImportance: 0.5,
    expiresAfterDays: null,
    requiresSessionId: false,
    maxPerAgent: null,
  },
  semantic: {
    defaultImportance: 0.6,
    expiresAfterDays: null,
    requiresSessionId: false,
    maxPerAgent: null,
  },
  procedural: {
    defaultImportance: 0.7,
    expiresAfterDays: null,
    requiresSessionId: false,
    maxPerAgent: null,
  },
};

export function getLayerDefaults(layer: MemoryLayer): LayerDefaults {
  return LAYER_DEFAULTS[layer];
}

export function validateEncodeInput(input: EncodeInput): string | null {
  const defaults = LAYER_DEFAULTS[input.layer];

  if (!input.content || input.content.trim().length === 0) {
    return "Content must not be empty";
  }

  if (defaults.requiresSessionId && !input.sessionId) {
    return `Layer '${input.layer}' requires a sessionId`;
  }

  if (input.importance !== undefined && (input.importance < 0 || input.importance > 1)) {
    return "Importance must be between 0 and 1";
  }

  return null;
}

export function applyLayerDefaults(input: EncodeInput): EncodeInput {
  const defaults = LAYER_DEFAULTS[input.layer];

  return {
    ...input,
    importance: input.importance ?? defaults.defaultImportance,
    agentId: input.agentId ?? "default",
  };
}

export function computeExpiresAt(layer: MemoryLayer): string | null {
  const defaults = LAYER_DEFAULTS[layer];
  if (!defaults.expiresAfterDays) return null;

  const expires = new Date();
  expires.setDate(expires.getDate() + defaults.expiresAfterDays);
  return expires.toISOString();
}
