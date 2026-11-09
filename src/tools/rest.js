import { z } from 'zod';

import { METHOD_NAME } from '../client.js';
import { READ, DESTRUCTIVE } from './shared.js';

const MAX_BATCH_CALLS = 50;
const DOCS_URL = 'https://apidocs.bitrix24.com/';

export const restTools = [
  {
    name: 'b24_check_connection',
    description: 'Check the webhook: portal address, webhook user and the scopes it has. Call first when other tools fail with access errors.',
    annotations: READ,
    input: {},
    run: async (client) => {
      const [profile, scope] = await Promise.all([client.call('profile'), client.call('scope')]);
      const user = profile.result;
      return {
        portal: client.portal,
        user: { id: Number(user.ID), name: [user.NAME, user.LAST_NAME].filter(Boolean).join(' '), is_admin: user.ADMIN === true },
        scopes: scope.result,
      };
    },
  },
  {
    name: 'b24_call',
    description:
      `Call any Bitrix24 REST method when no dedicated tool fits (reference: ${DOCS_URL}). ` +
      'Examples: "crm.stagehistory.list", "crm.deal.userfield.list", "tasks.task.list". Write methods change portal data — be careful.',
    annotations: DESTRUCTIVE,
    input: {
      method: z.string().regex(METHOD_NAME).describe('Method name, e.g. "crm.deal.list"'),
      params: z.record(z.any()).optional().describe('Method parameters as a JSON object'),
    },
    run: async (client, { method, params }) => {
      const { result, total, next } = await client.call(method, params ?? {});
      return { result, total, next };
    },
  },
  {
    name: 'b24_batch',
    description:
      `Run up to ${MAX_BATCH_CALLS} REST calls in one request. Later calls can reference earlier results: "$result[deal][CONTACT_ID]". ` +
      'Useful for reports that need many lookups.',
    annotations: DESTRUCTIVE,
    input: {
      calls: z.record(z.object({
        method: z.string().regex(METHOD_NAME),
        params: z.record(z.any()).optional(),
      })).describe('Calls keyed by alias, e.g. { "deal": { "method": "crm.deal.get", "params": { "id": 5 } } }'),
    },
    run: async (client, { calls }) => {
      const aliases = Object.keys(calls);
      if (aliases.length === 0 || aliases.length > MAX_BATCH_CALLS) {
        throw new Error(`Pass from 1 to ${MAX_BATCH_CALLS} calls`);
      }
      const cmd = Object.fromEntries(aliases.map((alias) => {
        const { method, params } = calls[alias];
        const query = toQueryString(params ?? {});
        return [alias, query ? `${method}?${query}` : method];
      }));
      const { result } = await client.call('batch', { halt: 0, cmd });
      return { results: result.result, errors: result.result_error, totals: result.result_total, next: result.result_next };
    },
  },
];

/** PHP-style query string (`filter[STAGE_ID]=WON`) — the format batch expects inside each command. */
export function toQueryString(params) {
  const pairs = [];
  appendPairs(pairs, params, undefined);
  return pairs.join('&');
}

function appendPairs(pairs, value, prefix) {
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      appendPairs(pairs, nested, prefix ? `${prefix}[${key}]` : key);
    }
    return;
  }
  if (value === undefined || value === null) {
    return;
  }
  pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
}
