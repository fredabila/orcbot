# Tuning OrcBot Agent Memory for Maximum Performance

OrcBot is a powerful autonomous agent, but its effectiveness depends heavily on how you configure its memory system. By default, OrcBot is tuned for safety and efficiency, but advanced users can expand its memory and context windows to unlock deeper reasoning, richer context, and more persistent knowledge. This guide explains how to tweak your configuration for best results.

## 1. Understanding OrcBot's Memory Layers

OrcBot uses a multi-layered memory system:

- **Short-term memory**: Recent steps, tool results, and observations (default: ~30 entries)
- **Episodic memory**: Summaries of completed actions and key events
- **Long-term memory**: Curated facts and knowledge (in `MEMORY.md`, `LEARNING.md`, etc.)
- **Vector memory**: Embedding-based semantic search for relevant context

All memory is file-backed under `~/.orcbot/` by default.

## 2. Key Config Options to Expand Memory

Edit your `orcbot.config.yaml` (usually in `~/.orcbot/`):

```yaml
# Increase the number of recent short memories injected into LLM prompts
memoryShortLimit: 50   # Default is 20-30; higher = more context, but more tokens

# Expand episodic memory window
memoryEpisodicLimit: 10   # Default is 5; higher = more summaries in context

# Enable or tune vector memory (semantic search)
vectorMemoryEnabled: true
vectorMemoryLimit: 1000   # Number of indexed memories; higher = better recall, more disk usage

# Raise memory content length (for tool results, etc.)
memoryContentMaxLength: 3000   # Default is 1500; higher = more detail per entry

# Control consolidation and compaction
memoryFlushEnabled: true
memoryConsolidationThreshold: 40   # When to summarize/compact short memory
```

## 3. Tips for Best Results

- **Balance context size and cost**: More memory means richer context, but also higher LLM token usage. If you hit context window limits, increase only as much as your model can handle.
- **Enable vector memory**: This allows OrcBot to recall relevant facts even from older conversations. Requires an OpenAI or Google embedding API key.
- **Tune consolidation**: If your agent forgets too quickly, raise `memoryConsolidationThreshold` and `memoryShortLimit`.
- **Monitor performance**: Watch logs for memory flushes, compaction, and context truncation. If you see frequent truncation, increase limits or reduce prompt verbosity.
- **Never store secrets**: Memory is file-backed and not encrypted by default.

## 4. Advanced: Forcing More Context Into Prompts

- Set `decisionEngineAutoCompaction: false` to disable aggressive context shrinking (useful for research tasks).
- Increase `maxSteps` and `maxMessages` to allow longer action loops (at the cost of more memory usage).
- Use the `memory_search` and `semanticSearch` skills to surface long-term facts on demand.

## 5. Example: Aggressive Memory Expansion

```yaml
memoryShortLimit: 80
memoryEpisodicLimit: 20
vectorMemoryEnabled: true
vectorMemoryLimit: 2000
memoryContentMaxLength: 4000
memoryConsolidationThreshold: 80
maxSteps: 50
maxMessages: 30
decisionEngineAutoCompaction: false
```

## 6. Reloading Config

After editing your config, reload OrcBot or run:

```
orcbot config reload
```

OrcBot will hot-reload most settings automatically.

---

**Summary:**
Tuning OrcBot's memory lets you unlock deeper reasoning and richer context. Expand memory limits thoughtfully, monitor performance, and adjust as needed for your use case. For more, see the [project documentation](../README.md) or `orcbot config --help`.
