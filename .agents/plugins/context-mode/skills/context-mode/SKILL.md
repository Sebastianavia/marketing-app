---
name: context-mode
description: Mandatory routing rules and utilities for context-mode. Invoke when exploring a codebase, reading files for analysis, searching, parsing, counting, comparing, summarizing, fetching web content, running data-heavy commands, or checking ctx stats.
---

# context-mode for Antigravity

context-mode MCP tools are configured for this project to protect the context window.
When calling context-mode tools via Antigravity MCP:

- `ServerName`: `"context-mode"`
- `ToolName`: One of the tool names below
- `Arguments`: JSON parameters for that tool

## Available Tools

- `ctx_execute`: run JavaScript, TypeScript, Python, shell, or other code in a sandbox. Print only the final answer (`console.log()`).
- `ctx_execute_file`: read one file into `FILE_CONTENT` inside the sandbox and run code over it.
- `ctx_batch_execute`: run multiple commands in one batch, index large output, and answer follow-up queries.
- `ctx_index`: store a file, directory, or content in the local FTS5 knowledge base for later search.
- `ctx_search`: search indexed content and captured session memory. Batch related queries in `queries: [...]`.
- `ctx_fetch_and_index`: fetch web content, store it, then query with `ctx_search`.
- `ctx_stats`: show context savings and current-session statistics.
- `ctx_doctor`: diagnose context-mode runtime health and dependencies.
- `ctx_upgrade`: provide upgrade or repair guidance.
- `ctx_purge`: purge stored context-mode knowledge after confirmation.
- `ctx_insight`: launch or report Insight analytics.

## Key Principles

1. **Think in Code**: Always prefer running a small script to compute results rather than loading dozens of files into the context window.
2. **Never Dump Full Files**: Extract only the lines, counts, or fields required.
3. **Sandbox First**: Process large API responses, logs, and HTML via sandbox execution and indexing.
