import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Bitrix24Error } from '../src/client.js';
import { readWebhookUrl } from '../src/config.js';
import { WEBHOOK, clientWith } from './helpers.js';

describe('readWebhookUrl', () => {
  it('appends the trailing slash', () => {
    assert.equal(readWebhookUrl({ BITRIX24_WEBHOOK_URL: 'https://demo.bitrix24.ru/rest/1/secretcode' }), WEBHOOK);
  });

  it('rejects a non-webhook URL without echoing it', () => {
    assert.throws(
      () => readWebhookUrl({ BITRIX24_WEBHOOK_URL: 'http://demo.bitrix24.ru/rest/1/secretcode/' }),
      (error) => !error.message.includes('secretcode'),
    );
    assert.throws(() => readWebhookUrl({ BITRIX24_WEBHOOK_URL: 'https://demo.bitrix24.ru/' }), /unexpected shape/);
    assert.throws(() => readWebhookUrl({}), /not set/);
  });
});

describe('Bitrix24Client', () => {
  it('posts JSON params to <webhook><method>.json', async () => {
    const { client, requests } = clientWith([{ result: { ID: '1' } }]);
    const response = await client.call('crm.deal.get', { id: 1 });
    assert.deepEqual(response.result, { ID: '1' });
    assert.equal(requests[0].url, `${WEBHOOK}crm.deal.get.json`);
    assert.deepEqual(JSON.parse(requests[0].body), { id: 1 });
  });

  it('turns a REST error into Bitrix24Error without the webhook URL', async () => {
    const { client } = clientWith([{ status: 400, body: { error: 'ACCESS_DENIED', error_description: 'No access' } }]);
    await assert.rejects(client.call('crm.deal.get', {}), (error) => {
      return error instanceof Bitrix24Error && error.code === 'ACCESS_DENIED' && !error.message.includes('secretcode');
    });
  });

  it('refuses method names that would escape the webhook path', async () => {
    const { client, requests } = clientWith([]);
    await assert.rejects(client.call('../../admin', {}), /INVALID_METHOD/);
    assert.equal(requests.length, 0);
  });

  it('retries a call the portal rejected by the rate limit', async () => {
    const { client, requests } = clientWith([
      { status: 503, body: { error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' } },
      { result: true },
    ]);
    assert.equal((await client.call('crm.deal.update', {})).result, true);
    assert.equal(requests.length, 2);
  });

  it('does not retry other failures, so a write is never sent twice', async () => {
    const { client, requests } = clientWith([{ status: 500, body: { error: 'INTERNAL_SERVER_ERROR' } }]);
    await assert.rejects(client.call('crm.deal.add', {}), /INTERNAL_SERVER_ERROR/);
    assert.equal(requests.length, 1);
  });

  it('spaces concurrent calls by the minimum interval', async () => {
    const sleeps = [];
    const { client } = clientWith([{ result: 1 }, { result: 2 }, { result: 3 }], { sleeps, minIntervalMs: 500 });
    await Promise.all([client.call('a.b'), client.call('a.b'), client.call('a.b')]);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps.every((ms) => ms > 0 && ms <= 1000));
  });

  it('listAll follows `next` and unwraps items', async () => {
    const { client, requests } = clientWith([
      { result: { tasks: [{ id: 1 }, { id: 2 }] }, next: 2, total: 3 },
      { result: { tasks: [{ id: 3 }] }, total: 3 },
    ]);
    const page = await client.listAll('tasks.task.list', { filter: {} }, (result) => result.tasks);
    assert.deepEqual(page, { items: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 3, truncated: false });
    assert.equal(JSON.parse(requests[1].body).start, 2);
  });
});
