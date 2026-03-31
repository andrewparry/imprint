# Imprint

Multi-layered cognitive memory and task management plugin for [OpenClaw](https://github.com/openclaw/openclaw).

Imprint gives your OpenClaw agents persistent, searchable memory across six cognitive layers and a fully integrated task/ticket system for multi-agent coordination. It is **local-first** (SQLite, no external services), **fast** (sub-10ms cached reads, hybrid BM25 + vector retrieval), and **zero-config** (no API keys needed for embeddings).

## Features

- **6 memory layers**: soul, project, session, episodic, semantic, procedural
- **Hybrid search**: BM25 full-text + vector similarity + composite scoring (recency + importance)
- **Task system**: Create, assign, track tasks between agents with decision recording
- **Local-first**: SQLite + FTS5 + sqlite-vec + in-process embeddings (no external services)
- **Auto-recall**: Injects relevant memories and open tasks at session start
- **Auto-capture**: Optionally captures important facts from conversations
- **Migration**: Import existing OpenClaw `MEMORY.md` and daily notes
- **Monitoring**: Health checks, metrics JSON, and HTML dashboard
- **Optional Redis**: Hot-cache and pub/sub for multi-agent deployments

---

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Migrating Existing Memories](#migrating-existing-memories)
4. [Memory Layers](#memory-layers)
5. [Agent Tools Reference](#agent-tools-reference)
6. [Configuration](#configuration)
7. [Multi-Agent Setup](#multi-agent-setup)
8. [CLI Commands](#cli-commands)
9. [HTTP Endpoints](#http-endpoints)
10. [Architecture](#architecture)
11. [Development](#development)
12. [Comparison](#comparison-with-other-memory-systems)
13. [Troubleshooting](#troubleshooting)

---

## Installation

### Prerequisites

- **OpenClaw** >= 2026.3.0 ([install guide](https://docs.openclaw.ai))
- **Node.js** >= 20.0.0

### Option A: Install via OpenClaw CLI (recommended)

The simplest path. Run this in your terminal:

```bash
openclaw plugins install @imprint/openclaw-plugin
```

Then enable the plugin:

```bash
openclaw plugins enable imprint
```

That's it. Imprint is now active for all agents in your gateway. No configuration file edits needed -- the defaults work out of the box.

### Option B: Install from npm into an existing OpenClaw project

If you manage your OpenClaw gateway as a Node.js project:

```bash
cd /path/to/your/openclaw-project
npm install @imprint/openclaw-plugin
```

Then tell OpenClaw to load the plugin. Open (or create) your workspace config file:

```jsonc
// openclaw.config.json
{
  "plugins": {
    "imprint": {
      "enabled": true
    }
  }
}
```

Restart the gateway and Imprint is ready.

### Option C: Install from source (for development or customization)

```bash
# 1. Clone the repository
git clone https://github.com/your-org/imprint.git
cd imprint

# 2. Install dependencies
npm install

# 3. Build the plugin
npm run build

# 4. Link to your OpenClaw gateway
openclaw plugins install ./dist
openclaw plugins enable imprint
```

### Verifying the installation

After installing, confirm Imprint is loaded:

```bash
openclaw plugins list
```

You should see `imprint` in the output with status `enabled`. You can also run:

```bash
openclaw imprint stats
```

This prints memory and task counts (both zero on a fresh install) confirming the database initialized correctly.

### What happens on first launch

1. Imprint creates a `.imprint/` directory in your workspace containing `imprint.db` (the SQLite database).
2. On the first memory operation, the embedding model (`all-MiniLM-L6-v2`, ~22MB) is downloaded once and cached locally. No API key is needed. Subsequent launches load the cached model in under a second.
3. All 12 agent tools (`imprint_remember`, `imprint_recall`, `imprint_task_create`, etc.) become available to every agent session automatically.

---

## Quick Start

Once installed, agents automatically get access to Imprint tools. No additional setup is needed.

### 1. Set agent identity (soul memory)

```
Agent: I'll set up my identity using imprint_soul_set.
-> imprint_soul_set({
    identity: "I am a senior backend engineer focused on API design",
    values: "Clean code, thorough testing, clear documentation",
    style: "Technical, concise, uses code examples"
  })
```

### 2. Store project context

```
Agent: Let me remember this project decision.
-> imprint_remember({
    content: "We chose PostgreSQL over MongoDB for ACID compliance",
    layer: "project",
    importance: 0.8,
    tags: ["architecture", "database"]
  })
```

### 3. Recall memories

```
Agent: What database are we using?
-> imprint_recall({
    query: "database choice",
    layers: ["project", "semantic"]
  })
```

### 4. Create and assign tasks

```
Agent A: I need Agent B to review the API changes.
-> imprint_task_create({
    title: "Review v2 API endpoint changes",
    description: "Check error handling and response schemas",
    priority: 1,
    createdBy: "agent-a",
    assignedTo: "agent-b",
    deadline: "2026-04-05T00:00:00Z"
  })
```

### 5. Record decisions

```
Agent: Let me record why we chose this approach.
-> imprint_decision_record({
    title: "Use cursor-based pagination",
    reasoning: "Offset pagination breaks with concurrent inserts; cursor is O(1)",
    outcome: "All list endpoints will use cursor-based pagination",
    taskId: "01JQXYZ...",
    agentId: "agent-a"
  })
```

---

## Migrating Existing Memories

If you already use OpenClaw's built-in Markdown memory (`MEMORY.md` and `memory/*.md` files), Imprint can import everything into its structured database. Your original files are never modified or deleted.

### Before you migrate

Make sure Imprint is installed and enabled (see [Installation](#installation)). Then check what you have:

```bash
# See what files exist in your workspace
ls -la MEMORY.md memory/
```

A typical OpenClaw workspace looks like:

```
workspace/
  MEMORY.md                  # Long-term facts and preferences
  memory/
    2026-03-28.md            # Daily note
    2026-03-29.md            # Daily note
    2026-03-30.md            # Daily note
    api-reference.md         # Topical notes
    team-contacts.md         # Topical notes
```

### Step 1: Preview the migration (dry run)

This shows exactly what will be imported without making any changes:

```bash
openclaw imprint migrate --workspace . --dry-run --verbose
```

Example output:

```
Imprint: Starting migration...
  [DRY RUN] Would create project memory: Architecture: We use a microservices...
  [DRY RUN] Would create project memory: Team Decisions: Always use TypeScript...
  [DRY RUN] Would create episodic memory: Morning Standup: Discussed the new...
  [DRY RUN] Would create episodic memory: Bug Report: Users are getting logged...
  [DRY RUN] Would create semantic memory: Endpoints: GET /api/users - List...

Migration (dry run) complete:
  Files processed: 5
  Records created: 12
  Skipped: 0
```

### Step 2: Run the actual migration

```bash
openclaw imprint migrate --workspace . --verbose
```

### Step 3: Verify the import

```bash
# Check counts by layer
openclaw imprint stats

# Search for something you know is in your old memory
openclaw imprint search "architecture" --limit 5
```

### What gets migrated where

| Source | How it's split | Destination layer | Why |
|--------|---------------|-------------------|-----|
| `MEMORY.md` | Each `##` heading becomes a separate record | **project** | MEMORY.md holds durable project facts and preferences |
| `memory/2026-03-30.md` | Each `##` heading becomes a separate record | **episodic** | Date-stamped files are events tied to a point in time |
| `memory/api-reference.md` | Each `##` heading becomes a separate record | **semantic** | Non-dated files are general knowledge and reference material |

### How importance is assigned

During migration, Imprint estimates importance heuristically based on content:

| Content pattern | Importance boost | Example |
|----------------|-----------------|---------|
| Action items (`todo`, `blocker`, `critical`, `must`) | +0.20 | "TODO: fix auth before release" |
| Rules and conventions (`always`, `never`, `prefer`, `rule`) | +0.15 | "Always use TypeScript for new code" |
| Code references (backticks, code blocks) | +0.05 | "Run \`npm test\` before merging" |
| URLs | +0.05 | "Dashboard at https://..." |
| Base (everything else) | 0.50 | "Went to the meeting today" |

You can adjust importance for any record after migration using `imprint_update`.

### Re-running is always safe

Migration is **idempotent**. A `migration_log` table tracks which files have been processed and their content hash. Running migrate again skips already-imported files:

```bash
# Safe to run multiple times
openclaw imprint migrate --workspace .
# Output: Skipped: 5, Files processed: 0
```

If a file's content has changed since the last migration, you can force re-import by clearing its log entry:

```bash
sqlite3 .imprint/imprint.db "DELETE FROM migration_log WHERE file_path = 'MEMORY.md';"
openclaw imprint migrate --workspace .
```

### Exporting back to Markdown

You can export Imprint's database back to Markdown at any time. This is useful for backups, sharing with non-Imprint setups, or human review:

```bash
# Export all layers to ./imprint-export/
openclaw imprint export --output ./imprint-export

# Export a specific layer
openclaw imprint export --output ./export --layer soul

# Export a specific agent's memories
openclaw imprint export --output ./export --agent agent-a
```

Each layer becomes a separate `.md` file (e.g. `soul.md`, `project.md`) with YAML frontmatter per entry:

```markdown
---
layer: project
importance: 0.8
created: 2026-03-31T10:00:00.000Z
tags: [architecture, database]
---

We chose PostgreSQL over MongoDB for ACID compliance
```

### Side-by-side operation

Imprint registers its tools with the `imprint_` prefix and **does not** override OpenClaw's built-in `memory_search` or `memory_get` tools. Both systems can run side by side. You can migrate at your own pace and disable the built-in memory plugin when you're ready:

```bash
openclaw plugins disable memory-core
```

---

## Memory Layers

| Layer | Purpose | Persistence | Default Importance |
|-------|---------|-------------|-------------------|
| **soul** | Agent identity, personality, values, communication style | Permanent | 0.9 |
| **project** | Workspace context, architecture, team decisions | Permanent | 0.7 |
| **session** | Current conversation working state | Session lifetime (7 day expiry) | 0.5 |
| **episodic** | Past events, conversations, outcomes | Permanent (archivable) | 0.5 |
| **semantic** | Facts, knowledge, learned patterns | Permanent | 0.6 |
| **procedural** | How-to knowledge, workflows, tool usage patterns | Permanent | 0.7 |

---

## Agent Tools Reference

### Memory Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `imprint_remember` | `content`, `layer`, `importance?`, `tags?`, `sessionId?` | Store a memory (auto-deduplicates) |
| `imprint_recall` | `query`, `layers?`, `limit?`, `minImportance?` | Hybrid search across memories |
| `imprint_forget` | `ids?`, `layer?`, `maxImportance?`, `archive?` | Remove or archive memories |
| `imprint_update` | `id`, `content?`, `importance?`, `summary?` | Update existing memory |
| `imprint_soul_get` | `agentId?` | Read agent soul/identity |
| `imprint_soul_set` | `identity`, `values?`, `style?`, `agentId?` | Set agent soul/identity |

### Task Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `imprint_task_create` | `title`, `createdBy`, `description?`, `priority?`, `assignedTo?`, `deadline?`, `dependsOn?` | Create a task |
| `imprint_task_update` | `id`, `status?`, `title?`, `description?`, `assignedTo?`, `priority?` | Update task |
| `imprint_task_list` | `status?`, `assignedTo?`, `createdBy?`, `search?`, `limit?` | List/filter tasks |
| `imprint_task_get` | `id` | Get full task details with decisions and dependencies |
| `imprint_decision_record` | `title`, `reasoning`, `agentId`, `outcome?`, `taskId?` | Record a decision |

### Admin Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `imprint_stats` | *(none)* | Memory counts, task counts, cache stats, DB size |

---

## Configuration

All configuration is optional. Imprint works out of the box with sensible defaults.

```jsonc
// openclaw.config.json
{
  "plugins": {
    "imprint": {
      // Directory for SQLite database (relative to workspace)
      "dataDir": ".imprint",

      // Local embedding model (downloaded once, ~22MB, no API key needed)
      "embeddingModel": "Xenova/all-MiniLM-L6-v2",

      // Auto-recall: inject soul/project memories + open tasks at session start
      "autoRecall": true,

      // Auto-capture: extract important facts from conversations automatically
      "autoCapture": false,

      // Composite scoring weights (must sum to ~1.0)
      "scoring": {
        "similarity": 0.5,   // How well the result matches the query
        "recency": 0.3,      // How recently the memory was accessed
        "importance": 0.2,   // Stored importance value
        "halfLifeDays": 30   // Recency decay half-life
      },

      // Background consolidation (merges duplicates, archives old memories)
      "consolidation": {
        "intervalMinutes": 30,
        "mergeThreshold": 0.92,   // Cosine similarity threshold for merging
        "archiveAfterDays": 90    // Archive memories not accessed for this long
      },

      // In-memory LRU cache
      "cache": {
        "maxEntries": 1000
      },

      // Optional Redis for multi-agent deployments
      "redis": {
        "enabled": false,
        "url": "redis://localhost:6379"
      }
    }
  }
}
```

---

## Multi-Agent Setup

### Without Redis (default, local-first)

Agents share the same SQLite database. Task assignments are discovered at session start:

1. Agent A creates a task with `assignedTo: "agent-b"`
2. When Agent B starts a session, the `before_agent_start` hook queries open tasks
3. Open tasks are injected into Agent B's context automatically
4. Agent B works on the task, updates status, records decisions
5. Agent A can check task status via `imprint_task_list`

### With Redis (recommended for real-time multi-agent)

Enable Redis for instant task notifications:

```json
{
  "plugins": {
    "imprint": {
      "redis": {
        "enabled": true,
        "url": "redis://localhost:6379"
      }
    }
  }
}
```

Install the peer dependency:

```bash
npm install ioredis
```

With Redis enabled:
- Task assignments publish notifications via pub/sub
- Frequently accessed memories are cached in Redis (L0 hot cache)
- Agents receive task updates in real-time without waiting for session restart

---

## CLI Commands

All CLI commands are accessed through the `openclaw imprint` subcommand.

### migrate -- Import Markdown memories

```bash
# Preview (no changes)
openclaw imprint migrate --workspace /path/to/workspace --dry-run --verbose

# Import for real
openclaw imprint migrate --workspace /path/to/workspace --verbose

# Default workspace is current directory
openclaw imprint migrate
```

See [Migrating Existing Memories](#migrating-existing-memories) for full details.

### export -- Export to Markdown

```bash
openclaw imprint export --output ./imprint-export
openclaw imprint export --output ./export --layer soul
openclaw imprint export --output ./export --agent agent-a
```

### stats -- Show statistics

```bash
openclaw imprint stats
```

Example output:

```
Imprint Statistics
==================

Memory:
  Total: 142 (archived: 8)
  soul: 3
  project: 24
  session: 0
  episodic: 78
  semantic: 31
  procedural: 6
  DB size: 847.2 KB

Tasks:
  Total: 15
  open: 3
  in_progress: 2
  done: 9
  cancelled: 1

Cache:
  Entries: 27/1000
  Hit rate: 73.4%
```

### search -- Search memories from CLI

```bash
openclaw imprint search "database architecture" --limit 5 --layer project
```

### reset -- Clear a memory layer

```bash
openclaw imprint reset session
openclaw imprint reset episodic --agent agent-a
```

---

## HTTP Endpoints

When the OpenClaw gateway supports HTTP routes:

| Endpoint | Description |
|----------|-------------|
| `GET /imprint/health` | Health check (DB status, cache, embedding model) |
| `GET /imprint/metrics` | JSON metrics (memory counts, task counts, performance) |
| `GET /imprint/dashboard` | HTML dashboard with visual statistics |

---

## Architecture

```
Imprint Plugin
+-- Memory Engine (encode/recall/consolidate/extract/forget)
|   +-- L1 LRU Cache (in-memory, sub-0.1ms reads)
|   +-- SQLite + WAL mode (sub-2ms reads)
|   |   +-- FTS5 (BM25 keyword search)
|   |   +-- sqlite-vec (vector similarity search)
|   +-- Composite Scoring (similarity x w1 + recency x w2 + importance x w3)
+-- Task Manager (CRUD, status machine, dependencies, decisions)
+-- Retrieval Pipeline (query -> embed -> parallel search -> RRF fusion -> rank)
+-- Hooks (session start/end, auto-capture)
+-- CLI (migrate, export, stats, search, reset)
+-- HTTP (health, metrics, dashboard)
+-- Optional Redis (hot cache, pub/sub)
```

### How retrieval works

1. **Embed** the query using the local transformer model (~10ms)
2. **Parallel search**: sqlite-vec top-K (vector similarity) + FTS5 top-K (BM25 keyword)
3. **Fuse** results using Reciprocal Rank Fusion (RRF)
4. **Score** each result: `score = similarity x 0.5 + recency x 0.3 + importance x 0.2`
5. **Return** top-N ranked results

### How deduplication works

1. **Exact match**: Content hash checked first (instant, O(1))
2. **Near-duplicate**: Vector similarity > 0.85 merges into existing memory
3. **Background**: Consolidation service merges memories with > 0.92 similarity every 30 minutes

---

## Performance

| Operation | Latency |
|-----------|---------|
| L1 cache read | < 0.1ms |
| SQLite indexed query | 0.1-2ms |
| Full hybrid recall (BM25 + vector + scoring) | 15-30ms |
| Memory encode (with embedding) | 10-20ms |
| First embedding model load | 3-10s (one-time, cached) |

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests (87 tests, ~700ms)
npm test

# Watch mode
npm run test:watch

# Type check
npm run lint

# Dev mode (rebuild on change)
npm run dev
```

### Running tests

Tests use in-memory SQLite databases and mock embedding services, so they run fast with no external dependencies:

```bash
# All tests
npm test

# Specific test file
npx vitest run tests/unit/scoring.test.ts

# Watch specific tests
npx vitest tests/unit/cache.test.ts
```

---

## Comparison with Other Memory Systems

| Feature | Imprint | OpenClaw Built-in | memory-lancedb |
|---------|---------|-------------------|----------------|
| Storage | SQLite (structured) | Markdown files | LanceDB |
| Embedding | Local (no API key) | Requires API key | Requires API key |
| Memory layers | 6 typed layers | Flat files | Categories |
| Task system | Full CRUD + deps | None | None |
| Search | Hybrid BM25 + vector | Hybrid (if API key) | Vector only |
| Composite scoring | similarity + recency + importance | similarity + temporal decay | similarity only |
| Auto-dedup | Hash + vector similarity | None | Vector similarity |
| Migration | Built-in CLI | N/A | None |
| Dashboard | HTML + JSON metrics | None | None |
| Redis support | Optional hot-cache + pub/sub | None | None |
| External deps | None required | Embedding API key | OpenAI API key |

---

## Troubleshooting

### Embedding model download

On first use, Imprint downloads the `all-MiniLM-L6-v2` model (~22MB). This happens once and is cached in the data directory. If you're behind a proxy, set the `HTTPS_PROXY` environment variable before starting the gateway.

### sqlite-vec not loading

If sqlite-vec fails to load (unsupported platform), Imprint falls back to BM25-only search. Vector similarity will be unavailable but all other features work normally. To install sqlite-vec explicitly:

```bash
npm install sqlite-vec
```

### Database locked errors

If you see "database is locked" errors in multi-agent setups, ensure WAL mode is active (it should be by default). If issues persist, enable Redis for hot-path coordination.

### Migration says "Skipped" for a file I changed

Migration tracks processed files by path. If you've edited a file after migrating it, clear its log entry and re-run:

```bash
sqlite3 .imprint/imprint.db "DELETE FROM migration_log WHERE file_path = 'MEMORY.md';"
openclaw imprint migrate --workspace .
```

### Where is the database?

By default at `.imprint/imprint.db` relative to your OpenClaw workspace. You can change this with the `dataDir` config option. To inspect it directly:

```bash
sqlite3 .imprint/imprint.db ".tables"
sqlite3 .imprint/imprint.db "SELECT layer, COUNT(*) FROM memories GROUP BY layer;"
```

---

## License

MIT
