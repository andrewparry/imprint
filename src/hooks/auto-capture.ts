import type { MemoryEngine } from "../memory/engine.js";

/**
 * Patterns that suggest content worth capturing.
 */
const CAPTURE_TRIGGERS = [
  /remember|zapamatuj|pamatuj/i,
  /prefer|radši|like|love|hate|want|need/i,
  /decided|decision|rozhodli|budeme/i,
  /important|critical|always|never/i,
  /my\s+\w+\s+is|is\s+my/i,
  /i\s+(like|prefer|hate|love|want|need)/i,
  /[\w.-]+@[\w.-]+\.\w+/, // email
  /\+\d{10,}/, // phone
];

/**
 * Patterns that suggest prompt injection or system content.
 */
const INJECTION_PATTERNS = [
  /ignore (all|any|previous|above|prior) instructions/i,
  /system prompt|developer message/i,
  /<\s*(system|assistant|developer|tool)\b/i,
];

/**
 * Detect category for auto-captured content.
 */
function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/prefer|like|love|hate|want/i.test(lower)) return "preference";
  if (/decided|decision|will use/i.test(lower)) return "decision";
  if (/\+\d{10,}|@[\w.-]+\.\w+|is called/i.test(lower)) return "entity";
  if (/is|are|has|have/i.test(lower)) return "fact";
  return "observation";
}

export function shouldCapture(text: string): boolean {
  if (text.length < 10 || text.length > 500) return false;
  if (text.includes("<relevant-memories>")) return false;
  if (text.includes("<imprint-")) return false;
  if (INJECTION_PATTERNS.some((p) => p.test(text))) return false;
  return CAPTURE_TRIGGERS.some((p) => p.test(text));
}

/**
 * Create auto-capture hook for agent_end event.
 */
export function createAutoCaptureHook(engine: MemoryEngine) {
  return async (event: {
    success?: boolean;
    messages?: unknown[];
    agentId?: string;
  }) => {
    if (!event.success || !event.messages?.length) return;

    const agentId = event.agentId ?? "default";
    let captured = 0;

    for (const msg of event.messages) {
      if (!msg || typeof msg !== "object") continue;
      const msgObj = msg as Record<string, unknown>;

      // Only process user messages
      if (msgObj.role !== "user") continue;

      const texts: string[] = [];
      if (typeof msgObj.content === "string") {
        texts.push(msgObj.content);
      } else if (Array.isArray(msgObj.content)) {
        for (const block of msgObj.content) {
          if (
            block &&
            typeof block === "object" &&
            (block as Record<string, unknown>).type === "text" &&
            typeof (block as Record<string, unknown>).text === "string"
          ) {
            texts.push((block as Record<string, unknown>).text as string);
          }
        }
      }

      for (const text of texts) {
        if (!shouldCapture(text) || captured >= 3) continue;

        try {
          const category = detectCategory(text);
          await engine.encode({
            content: text,
            layer: "episodic",
            importance: 0.6,
            agentId,
            metadata: { autoCapture: true, category },
            sourceType: "system",
          });
          captured++;
        } catch {
          // Silent failure for auto-capture
        }
      }
    }
  };
}
