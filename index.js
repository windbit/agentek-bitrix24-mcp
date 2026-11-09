#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { Bitrix24Client } from './src/client.js';
import { readWebhookUrl } from './src/config.js';
import { createServer } from './src/server.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const client = new Bitrix24Client({ webhookUrl: readWebhookUrl() });
await createServer({ client, version }).connect(new StdioServerTransport());
