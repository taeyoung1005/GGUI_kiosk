// 실행 중인 GGUI MCP 서버의 실제 tool 목록 + 스키마 덤프 (진단용).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = (process.env.GGUI_URL || "http://localhost:6781").replace(/\/$/, "");
const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
  requestInit: { headers: { Authorization: "Bearer dev" } },
});
const client = new Client({ name: "inspect", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("ALL TOOLS:", tools.map((t) => t.name).join(", "));
console.log("");
for (const t of tools) {
  if (/handshake|render|push|session|generate|blueprint/i.test(t.name)) {
    console.log("== TOOL:", t.name, "==");
    console.log("desc:", (t.description || "").slice(0, 160));
    console.log("schema:", JSON.stringify(t.inputSchema));
    console.log("");
  }
}
await client.close();
