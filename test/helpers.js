import { Bitrix24Client } from '../src/client.js';

export const WEBHOOK = 'https://demo.bitrix24.ru/rest/1/secretcode/';

export function clientWith(responses, { sleeps = [], minIntervalMs = 0 } = {}) {
  const requests = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: init.body });
    const next = queue.shift() ?? { result: undefined };
    const status = next.status ?? 200;
    const body = next.body ?? next;
    return new Response(JSON.stringify(body), { status });
  };
  const sleep = async (ms) => {
    sleeps.push(ms);
  };
  return { client: new Bitrix24Client({ webhookUrl: WEBHOOK, fetchImpl, sleep, minIntervalMs }), requests };
}
