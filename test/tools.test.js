import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOOLS, runTool } from '../src/server.js';
import { toQueryString } from '../src/tools/rest.js';
import { clientWith } from './helpers.js';

function tool(name) {
  const found = TOOLS.find((candidate) => candidate.name === name);
  assert.ok(found, `tool ${name} is registered`);
  return found;
}

function sentParams(requests, index = 0) {
  return { method: requests[index].url.split('/').pop().replace(/\.json$/, ''), params: JSON.parse(requests[index].body) };
}

describe('tool registry', () => {
  it('has unique names and no per-call webhook parameter', () => {
    const names = TOOLS.map((candidate) => candidate.name);
    assert.equal(new Set(names).size, names.length);
    for (const candidate of TOOLS) {
      assert.ok(!('webhook_url' in candidate.input), `${candidate.name} must not accept a webhook URL`);
    }
  });
});

describe('crm tools', () => {
  it('routes smart processes to crm.item.* with entityTypeId outside fields', async () => {
    const { client, requests } = clientWith([{ result: { item: { id: 7 } } }]);
    const result = await tool('b24_crm_create').run(client, { entity_type_id: 128, fields: { title: 'X' } });
    assert.deepEqual(result, { id: 7 });
    assert.deepEqual(sentParams(requests), { method: 'crm.item.add', params: { entityTypeId: 128, fields: { title: 'X' } } });
  });

  it('rejects entity together with entity_type_id', async () => {
    const { client } = clientWith([]);
    const response = await runTool(tool('b24_crm_get'), client, { entity: 'deal', entity_type_id: 128, id: 1 });
    assert.equal(response.isError, true);
  });

  it('sends a lower-case entity type to the timeline', async () => {
    const { client, requests } = clientWith([{ result: 55 }]);
    await tool('b24_crm_timeline_comment_add').run(client, { entity: 'deal', id: 3, comment: 'Called' });
    assert.equal(sentParams(requests).params.fields.ENTITY_TYPE, 'deal');
  });

  it('maps deal pipelines to their stage dictionaries', async () => {
    const { client, requests } = clientWith([
      { result: { categories: [{ id: 0, name: 'Main', isDefault: 'Y' }, { id: 4, name: 'Wholesale', isDefault: 'N' }] } },
      { result: [{ STATUS_ID: 'NEW', NAME: 'New', SORT: '10', SEMANTICS: null }, { STATUS_ID: 'WON', NAME: 'Won', SORT: '60', SEMANTICS: 'S' }] },
      { result: [{ STATUS_ID: 'C4:LOSE', NAME: 'Lost', SORT: '70', SEMANTICS: 'F' }] },
    ]);
    const funnels = await tool('b24_crm_pipelines').run(client, {});
    assert.equal(sentParams(requests, 1).params.filter.ENTITY_ID, 'DEAL_STAGE');
    assert.equal(sentParams(requests, 2).params.filter.ENTITY_ID, 'DEAL_STAGE_4');
    assert.deepEqual(funnels[0].stages.map((stage) => stage.outcome), ['in_progress', 'won']);
    assert.equal(funnels[1].stages[0].outcome, 'lost');
  });

  it('returns one page with the next offset', async () => {
    const { client } = clientWith([{ result: [{ ID: '1' }], total: 120, next: 50 }]);
    const page = await tool('b24_crm_list').run(client, { entity: 'lead' });
    assert.deepEqual(page, { items: [{ ID: '1' }], total: 120, next: 50 });
  });
});

describe('other tools', () => {
  it('uploads a file as [name, base64]', async () => {
    const { client, requests } = clientWith([{ result: { ID: 9, NAME: 'a.txt', DETAIL_URL: 'https://x' } }]);
    await tool('b24_disk_file_upload').run(client, { folder_id: 1, name: 'a.txt', content_base64: 'aGk=' });
    assert.deepEqual(sentParams(requests).params.fileContent, ['a.txt', 'aGk=']);
  });

  it('posts to the feed with DEST audience', async () => {
    const { client, requests } = clientWith([{ result: 1 }]);
    await tool('b24_feed_post').run(client, { message: 'Hi' });
    assert.deepEqual(sentParams(requests).params.DEST, ['UA']);
  });

  it('builds a business process document id', async () => {
    const { client, requests } = clientWith([{ result: 'wf1' }]);
    await tool('b24_workflow_start').run(client, { template_id: 3, document_type: 'CCrmDocumentDeal', record_id: 15 });
    assert.deepEqual(sentParams(requests).params.DOCUMENT_ID, ['crm', 'CCrmDocumentDeal', 'DEAL_15']);
  });

  it('defaults the calendar owner to the webhook user', async () => {
    const { client, requests } = clientWith([{ result: { ID: '8' } }, { result: [] }]);
    await tool('b24_calendar_events').run(client, { from: '2026-11-01', to: '2026-11-30' });
    assert.equal(sentParams(requests, 1).params.ownerId, 8);
  });

  it('encodes batch commands as PHP query strings', () => {
    assert.equal(
      toQueryString({ filter: { STAGE_ID: 'WON', '>OPPORTUNITY': 100 }, select: ['ID', 'TITLE'] }),
      'filter%5BSTAGE_ID%5D=WON&filter%5B%3EOPPORTUNITY%5D=100&select%5B0%5D=ID&select%5B1%5D=TITLE',
    );
  });
});

describe('secret hygiene and amounts', () => {
  it('masks the webhook path in tool output', async () => {
    const { client } = clientWith([{ result: { ID: 5, URL: 'https://demo.bitrix24.ru/rest/1/secretcode/download/?token=x' } }]);
    const response = await runTool(tool('b24_call'), client, { method: 'disk.file.get', params: { id: 5 } });
    assert.ok(!response.content[0].text.includes('secretcode'));
    assert.match(response.content[0].text, /\/rest\/<webhook>\/download/);
  });

  it('drops the download link from Drive file details', async () => {
    const { client } = clientWith([{ result: { ID: 5, NAME: 'a', DOWNLOAD_URL: 'https://x', DETAIL_URL: 'https://y' } }]);
    assert.deepEqual(await tool('b24_disk_file_get').run(client, { file_id: 5 }), { ID: 5, NAME: 'a', DETAIL_URL: 'https://y' });
  });

  it('sets the deal amount to the total of its rows', async () => {
    const { client, requests } = clientWith([
      { result: true },
      { result: [{ PRICE: 3500, QUANTITY: 2 }, { PRICE: 100.5, QUANTITY: 1 }] },
      { result: true },
    ]);
    const result = await tool('b24_deal_products_set').run(client, { deal_id: 9, rows: [{ PRICE: 3500, QUANTITY: 2 }, { PRICE: 100.5, QUANTITY: 1 }] });
    assert.equal(result.amount, 7100.5);
    assert.deepEqual(sentParams(requests, 2), { method: 'crm.deal.update', params: { id: 9, fields: { OPPORTUNITY: 7100.5, IS_MANUAL_OPPORTUNITY: 'Y' } } });
  });
});
