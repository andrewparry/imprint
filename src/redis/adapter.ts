import type { MemoryRecord } from "../memory/types.js";
import type { Task } from "../tasks/types.js";
import type { RedisConfig } from "../config.js";

/**
 * Optional Redis adapter for multi-agent deployments.
 *
 * Provides:
 * 1. Hot cache for frequently accessed memories (L0 before L1 LRU)
 * 2. Pub/sub notifications for task assignments between agents
 *
 * Requires `ioredis` peer dependency to be installed.
 */

// ioredis is an optional peer dependency
type Redis = any;

const MEMORY_PREFIX = "imprint:mem:";
const TASK_CHANNEL_PREFIX = "imprint:tasks:";
const MEMORY_TTL = 3600; // 1 hour default

export class RedisAdapter {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private taskHandlers = new Map<string, (task: Task) => void>();
  private config: RedisConfig;

  constructor(config: RedisConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.enabled) return;

    try {
      // @ts-ignore - ioredis is an optional peer dependency
      const { default: IORedis } = await import(/* webpackIgnore: true */ "ioredis");
      this.client = new IORedis(this.config.url);
      this.subscriber = new IORedis(this.config.url);

      this.subscriber.on("message", (channel: string, message: string) => {
        const agentId = channel.replace(TASK_CHANNEL_PREFIX, "");
        const handler = this.taskHandlers.get(agentId);
        if (handler) {
          try {
            const task = JSON.parse(message) as Task;
            handler(task);
          } catch {
            // Invalid message format
          }
        }
      });
    } catch {
      // ioredis not available
      this.client = null;
      this.subscriber = null;
    }
  }

  async disconnect(): Promise<void> {
    await this.subscriber?.quit();
    await this.client?.quit();
    this.client = null;
    this.subscriber = null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  // =========================================================================
  // Memory hot cache
  // =========================================================================

  async cacheMemory(record: MemoryRecord, ttl?: number): Promise<void> {
    if (!this.client) return;
    const key = MEMORY_PREFIX + record.id;
    await this.client.setex(key, ttl ?? MEMORY_TTL, JSON.stringify(record));
  }

  async getCachedMemory(id: string): Promise<MemoryRecord | null> {
    if (!this.client) return null;
    const data = await this.client.get(MEMORY_PREFIX + id);
    return data ? (JSON.parse(data) as MemoryRecord) : null;
  }

  async invalidateMemory(id: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(MEMORY_PREFIX + id);
  }

  // =========================================================================
  // Task notifications via pub/sub
  // =========================================================================

  async notifyTaskAssignment(agentId: string, task: Task): Promise<void> {
    if (!this.client) return;
    const channel = TASK_CHANNEL_PREFIX + agentId;
    await this.client.publish(channel, JSON.stringify(task));
  }

  async subscribeToTasks(
    agentId: string,
    handler: (task: Task) => void,
  ): Promise<void> {
    if (!this.subscriber) return;
    this.taskHandlers.set(agentId, handler);
    await this.subscriber.subscribe(TASK_CHANNEL_PREFIX + agentId);
  }

  async unsubscribeFromTasks(agentId: string): Promise<void> {
    if (!this.subscriber) return;
    this.taskHandlers.delete(agentId);
    await this.subscriber.unsubscribe(TASK_CHANNEL_PREFIX + agentId);
  }
}
