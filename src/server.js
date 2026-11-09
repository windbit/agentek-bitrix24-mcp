import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { companyTools } from './tools/company.js';
import { communicationTools } from './tools/communication.js';
import { crmTools } from './tools/crm.js';
import { productTools } from './tools/products.js';
import { restTools } from './tools/rest.js';
import { taskTools } from './tools/tasks.js';

export const TOOLS = [...restTools, ...crmTools, ...productTools, ...taskTools, ...companyTools, ...communicationTools];

/** Builds the MCP server with every tool bound to one Bitrix24 client. */
export function createServer({ client, version }) {
  const server = new McpServer({ name: 'agentek-bitrix24-mcp', version });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
      (args) => runTool(tool, client, args),
    );
  }
  return server;
}

export async function runTool(tool, client, args) {
  try {
    const result = await tool.run(client, args);
    return { content: [{ type: 'text', text: client.redact(JSON.stringify(result ?? null)) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: client.redact(`Error: ${error.message}`) }], isError: true };
  }
}
