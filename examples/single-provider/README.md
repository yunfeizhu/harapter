# Single-provider reference application

This application demonstrates the complete portable Harapter path for one
host-selected Provider:

1. register a `ProviderAdapterFactory`;
2. connect a host-owned `HarnessProfile`;
3. inspect compatibility and observed capabilities;
4. create a Session and start a Run;
5. consume portable events and the authoritative terminal result;
6. close the Session and Client.

[`src/index.ts`](src/index.ts) is Provider-agnostic and imports only
`@harapter/core`. [`src/main.ts`](src/main.ts) is the composition root; it
selects the Codex Adapter without leaking Codex types into the portable path.

## Run the example

Build the workspace, then provide the absolute path or command name of a
host-installed, authenticated Codex executable:

```bash
pnpm build
HARAPTER_CODEX_COMMAND=/absolute/path/to/codex \
  pnpm --filter @harapter/example-single-provider start
```

The repository does not install, authenticate, or discover Codex. Running the
example starts an Adapter-owned App Server process, creates one ephemeral
Session and one Run, and sends a small fictional prompt to the configured model.
This may use Provider tokens and incur cost. The composition root creates a
dedicated temporary Workspace, makes it both the process working directory and
the Session Workspace, rejects approval requests, and selects Codex's read-only
sandbox. It closes the Session and Client before removing the temporary
Workspace, including when execution fails.

Output is newline-delimited JSON containing only connection identity,
compatibility, two capability modes, portable event types and sequence numbers,
and the terminal status. It intentionally omits prompts, message bodies, raw
events, Provider results, native state, errors, credentials, and local paths.
