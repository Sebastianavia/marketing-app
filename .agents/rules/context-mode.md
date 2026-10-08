# context-mode routing for Antigravity

context-mode MCP tools are configured for this project. Use them when the task analyzes, counts, filters, compares, searches, parses, transforms, fetches, or otherwise processes data. Raw bytes stay in the sandbox; only the derived answer enters the conversation.

## Do not dump — derive (most common mistake)

Do NOT use `ctx_execute_file` or `ctx_execute` to print a whole file or a full method/config. Print only the specific value, matches, count, or known line-range needed:

- WRONG: `ctx_execute_file(path: "config.yaml", language: "python", code: "print(FILE_CONTENT)")`
- RIGHT (value): `code: "const fs = require('fs'); const d = JSON.parse(FILE_CONTENT); console.log(d.name);"`
- RIGHT (matches): `code: "const lines = FILE_CONTENT.split('\\n'); lines.forEach((l, i) => { if (l.includes('target')) console.log(i + ': ' + l); });"`

If you need to read an exact byte range to edit it, native `view_file` on that range is appropriate.

## Tool call surface

In Antigravity, call `call_mcp_tool` with:
- `ServerName`: `"context-mode"`
- `ToolName`: `"ctx_execute"`, `"ctx_execute_file"`, `"ctx_batch_execute"`, `"ctx_fetch_and_index"`, `"ctx_search"`, or `"ctx_index"`
- `Arguments`: a JSON object for that tool

Argument shapes:
- `ctx_execute`: `{"language": "javascript", "code": "..."}`
- `ctx_execute_file`: `{"path": "path/to/file", "language": "javascript", "code": "..."}`
- `ctx_batch_execute`: `{"commands": [{"label": "...", "command": "..."}], "queries": ["..."]}`
- `ctx_fetch_and_index`: `{"url": "https://...", "source": "..."}`
- `ctx_search`: `{"queries": ["q1", "q2"]}`
- `ctx_index`: `{"path": "path/to/file-or-dir", "source": "..."}` or `{"content": "...", "source": "..."}`

## Mandatory routing

1. **Think in code**: For analyze/count/filter/compare/search/parse/transform tasks, write code with `ctx_execute` and print only the final answer. Program the analysis; do not read raw data into the conversation context.
2. **File read for analysis**: `ctx_execute_file` loads the file into `FILE_CONTENT` inside the sandbox. Print only selected lines, counts, matches, summaries, or structured results.
3. **Native file reading**: `view_file` is reserved for edits or small known ranges.
4. **Codebase reconnaissance**: Prefer `ctx_batch_execute` for multi-command repository analysis instead of many shell/list/search calls.
5. **Web content**: Use `ctx_fetch_and_index` then `ctx_search` to query it. Do not dump raw HTML into the conversation.
6. **Return derived answers**: Concetrate on concise summaries, snippets, or paths to written artifacts.
