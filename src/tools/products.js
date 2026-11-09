import { z } from 'zod';

import { READ, WRITE, idInput, listOutput } from './shared.js';

const DEFAULT_PRODUCT_FIELDS = ['ID', 'NAME', 'PRICE', 'CURRENCY_ID', 'SECTION_ID', 'ACTIVE', 'MEASURE'];

export const productTools = [
  {
    name: 'b24_products_list',
    description: 'List products of the CRM catalog. Filter examples: { "%NAME": "cable" }, { "SECTION_ID": 3 }, { ">=PRICE": 1000 }.',
    annotations: READ,
    input: {
      filter: z.record(z.any()).optional(),
      select: z.array(z.string()).optional().describe(`Fields to return; default ${DEFAULT_PRODUCT_FIELDS.join(', ')}`),
      start: z.number().int().nonnegative().optional(),
    },
    run: async (client, { filter, select, start }) => {
      const response = await client.call('crm.product.list', {
        filter: filter ?? {},
        select: select ?? DEFAULT_PRODUCT_FIELDS,
        order: { NAME: 'ASC' },
        start: start ?? 0,
      });
      return listOutput(response);
    },
  },
  {
    name: 'b24_products_get',
    description: 'Get one catalog product with all fields.',
    annotations: READ,
    input: { id: idInput },
    run: async (client, { id }) => (await client.call('crm.product.get', { id })).result,
  },
  {
    name: 'b24_products_create',
    description: 'Create a catalog product. Fields: NAME (required), PRICE, CURRENCY_ID (e.g. "RUB"), SECTION_ID, DESCRIPTION, ACTIVE ("Y"/"N").',
    annotations: WRITE,
    input: { fields: z.record(z.any()) },
    run: async (client, { fields }) => ({ id: (await client.call('crm.product.add', { fields })).result }),
  },
  {
    name: 'b24_products_update',
    description: 'Update a catalog product, e.g. its price.',
    annotations: WRITE,
    input: { id: idInput, fields: z.record(z.any()) },
    run: async (client, { id, fields }) => {
      await client.call('crm.product.update', { id, fields });
      return { id, updated: true };
    },
  },
  {
    name: 'b24_products_sections',
    description: 'List catalog sections (product categories).',
    annotations: READ,
    input: {},
    run: (client) => client.listAll('crm.productsection.list', { order: { NAME: 'ASC' } }),
  },
  {
    name: 'b24_deal_products_get',
    description: 'Get product rows of a deal: product, price, quantity, discount, tax.',
    annotations: READ,
    input: { deal_id: idInput },
    run: async (client, { deal_id }) => (await client.call('crm.deal.productrows.get', { id: deal_id })).result,
  },
  {
    name: 'b24_deal_products_set',
    description:
      'Replace ALL product rows of a deal with the passed list and set the deal amount to their total. ' +
      'To add a row, read the current rows with b24_deal_products_get and pass them together with the new one.',
    annotations: WRITE,
    input: {
      deal_id: idInput,
      rows: z.array(z.object({
        PRODUCT_ID: z.number().int().nonnegative().optional().describe('Catalog product id; omit for a free-text row'),
        PRODUCT_NAME: z.string().optional(),
        PRICE: z.number().nonnegative(),
        QUANTITY: z.number().positive(),
        DISCOUNT_RATE: z.number().min(0).max(100).optional(),
        DISCOUNT_TYPE_ID: z.literal(2).optional().describe('2 — discount in percent; set together with DISCOUNT_RATE'),
      }).passthrough()),
    },
    run: async (client, { deal_id, rows }) => {
      await client.call('crm.deal.productrows.set', { id: deal_id, rows });
      // Bitrix24 keeps the deal amount as it was after a REST change of rows,
      // and ignores a new OPPORTUNITY unless the amount is marked manual.
      const saved = (await client.call('crm.deal.productrows.get', { id: deal_id })).result;
      const amount = saved.reduce((sum, row) => sum + Number(row.PRICE) * Number(row.QUANTITY), 0);
      await client.call('crm.deal.update', { id: deal_id, fields: { OPPORTUNITY: amount, IS_MANUAL_OPPORTUNITY: 'Y' } });
      return { deal_id, rows: saved.length, amount };
    },
  },
];
