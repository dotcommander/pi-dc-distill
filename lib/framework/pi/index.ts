// pi/* adapter aggregate. Grouped 1:1 with @earendil-works/* packages.
// Per Phase 2 decision D4. Extensions consume via `dc-framework/pi` or
// the specific subpath; never directly from @earendil-works/*.
export * as CodingAgent from "./coding-agent";
export * as AgentCore from "./agent-core";
export * as Ai from "./ai";
export * as Tui from "./tui";
