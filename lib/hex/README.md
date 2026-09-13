# Hex

A typed client for Hex's public API, kept ready for data-insights work.
Nothing in the app calls it yet.

| File | Role |
|---|---|
| `openapi.json` | Hex's published API spec, vendored (`npm run hex:spec`) |
| `schema.d.ts` | Types generated from it (`npm run hex:types`) |
| `client.ts` | Typed, server-only API client (`HEX_API_TOKEN`) |

Sam's charts do **not** go through Hex; they are drawn in the chat from stored
series (`lib/charts/`, `components/chat/ChartFigure.tsx`). Hex can only export
images of chart cells added by hand in its editor, and neither its API nor its
MCP server can create those or publish a project, so every Hex-rendered chart
would depend on a manually built template.

## Tokens

- **Workspace token** (`hxtw_`, in `HEX_API_TOKEN`): reads and runs published
  projects. It cannot create or edit projects - Hex returns 403
  `Mutation:createHex`.
- **Personal access token** (`hxtp_`): acts as a user and can create projects
  and cells. Use one only for one-off setup; don't store it in env.

Hex allows 60 API requests/min per user and 25 concurrent kernels
(429 / 503 past those).
