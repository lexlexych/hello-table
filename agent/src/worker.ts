import { loadConfig } from "./config.ts";

// Job child argv does not include the parent `dev`/`start` command. Validate unconditionally here,
// before importing provider plugins, and close over this exact object in the agent definition.
const config = loadConfig();
const { createAgent } = await import("./agent-definition.ts");

export default createAgent(config);
