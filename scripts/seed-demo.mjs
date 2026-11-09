#!/usr/bin/env node
// Fills an empty test portal with a small sales department: companies, contacts, leads, deals in two pipelines,
// products, deal product rows, tasks and to-dos. Stops if the portal already has the demo companies.
// The webhook needs the crm, task, user and catalog scopes.
// Usage: BITRIX24_WEBHOOK_URL=... node scripts/seed-demo.mjs
import { Bitrix24Client } from '../src/client.js';
import { readWebhookUrl } from '../src/config.js';
import { productTools } from '../src/tools/products.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const COMPANIES = [
  { TITLE: 'ООО «Северный ветер»', INDUSTRY: 'MANUFACTURING', PHONE: '+78182400101', CITY: 'Архангельск' },
  { TITLE: 'ИП Лебедев', INDUSTRY: 'DELIVERY', PHONE: '+79212000202', CITY: 'Северодвинск' },
  { TITLE: 'АО «Поморская логистика»', INDUSTRY: 'DELIVERY', PHONE: '+78182400303', CITY: 'Архангельск' },
  { TITLE: 'ООО «Белое море Ритейл»', INDUSTRY: 'OTHER', PHONE: '+78152400404', CITY: 'Мурманск' },
  { TITLE: 'ООО «ТехноСтрой»', INDUSTRY: 'MANUFACTURING', PHONE: '+78122400505', CITY: 'Санкт-Петербург' },
];

const CONTACTS = [
  { NAME: 'Ирина', LAST_NAME: 'Смирнова', POST: 'Закупщик', company: 0, phone: '+79210000001', email: 'smirnova@severveter.ru' },
  { NAME: 'Олег', LAST_NAME: 'Кузнецов', POST: 'Директор', company: 0, phone: '+79210000002', email: 'kuznetsov@severveter.ru' },
  { NAME: 'Пётр', LAST_NAME: 'Лебедев', POST: 'Владелец', company: 1, phone: '+79212000202', email: 'lebedev@mail.ru' },
  { NAME: 'Наталья', LAST_NAME: 'Орлова', POST: 'Логист', company: 2, phone: '+79210000004', email: 'orlova@pomlog.ru' },
  { NAME: 'Дмитрий', LAST_NAME: 'Волков', POST: 'Коммерческий директор', company: 3, phone: '+79210000005', email: 'volkov@belmore.ru' },
  { NAME: 'Светлана', LAST_NAME: 'Попова', POST: 'Бухгалтер', company: 3, phone: '+79210000006', email: 'popova@belmore.ru' },
  { NAME: 'Андрей', LAST_NAME: 'Соколов', POST: 'Главный инженер', company: 4, phone: '+79210000007', email: 'sokolov@tehnostroy.ru' },
  { NAME: 'Мария', LAST_NAME: 'Новикова', POST: 'Частный клиент', company: undefined, phone: '+79210000008', email: 'novikova@yandex.ru' },
];

const PRODUCTS = [
  { NAME: 'Тепловая пушка ТП-5', PRICE: 18900 },
  { NAME: 'Генератор бензиновый 3 кВт', PRICE: 42500 },
  { NAME: 'Кабель ВВГнг 3×2,5 (бухта 100 м)', PRICE: 9800 },
  { NAME: 'Монтаж оборудования (час)', PRICE: 2500 },
  { NAME: 'Доставка по области', PRICE: 3500 },
  { NAME: 'Сервисное обслуживание (год)', PRICE: 24000 },
];

const LEADS = [
  { TITLE: 'Заявка с сайта: тепловые пушки на склад', NAME: 'Евгений', PHONE: '+79210000101', STATUS_ID: 'NEW', SOURCE_ID: 'WEB', OPPORTUNITY: 60000 },
  { TITLE: 'Звонок: генератор для дачи', NAME: 'Алексей', PHONE: '+79210000102', STATUS_ID: 'NEW', SOURCE_ID: 'CALL', OPPORTUNITY: 45000 },
  { TITLE: 'Запрос КП на кабель', NAME: 'Ольга', EMAIL: 'olga@stroykom.ru', STATUS_ID: 'IN_PROCESS', SOURCE_ID: 'EMAIL', OPPORTUNITY: 98000 },
  { TITLE: 'Выставка: сервисный договор', NAME: 'Виктор', PHONE: '+79210000104', STATUS_ID: 'IN_PROCESS', SOURCE_ID: 'TRADE_SHOW', OPPORTUNITY: 120000 },
  { TITLE: 'Рекомендация от Лебедева', NAME: 'Сергей', PHONE: '+79210000105', STATUS_ID: 'PROCESSED', SOURCE_ID: 'PARTNER', OPPORTUNITY: 30000 },
  { TITLE: 'Спам с формы', NAME: 'Test', EMAIL: 'spam@example.com', STATUS_ID: 'JUNK', SOURCE_ID: 'WEB' },
  { TITLE: 'Повторное обращение: доставка', NAME: 'Ирина', PHONE: '+79210000001', STATUS_ID: 'NEW', SOURCE_ID: 'CALL', OPPORTUNITY: 3500 },
];

// stage, company, contact, products [index, qty], days since begin, days to close
const MAIN_DEALS = [
  { TITLE: 'Северный ветер: 10 тепловых пушек', STAGE_ID: 'NEW', company: 0, contact: 0, rows: [[0, 10]], begin: 2, close: 14 },
  { TITLE: 'Лебедев: генератор и монтаж', STAGE_ID: 'PREPARATION', company: 1, contact: 2, rows: [[1, 1], [3, 3]], begin: 9, close: 5 },
  { TITLE: 'Поморская логистика: кабель на объект', STAGE_ID: 'PREPAYMENT_INVOICE', company: 2, contact: 3, rows: [[2, 12], [4, 1]], begin: 20, close: -3 },
  { TITLE: 'Белое море: сервис на год', STAGE_ID: 'EXECUTING', company: 3, contact: 4, rows: [[5, 1]], begin: 35, close: 10 },
  { TITLE: 'ТехноСтрой: генераторы для бригады', STAGE_ID: 'FINAL_INVOICE', company: 4, contact: 6, rows: [[1, 4], [4, 1]], begin: 40, close: 2 },
  { TITLE: 'Новикова: тепловая пушка', STAGE_ID: 'WON', contact: 7, rows: [[0, 1], [4, 1]], begin: 25, close: -10 },
  { TITLE: 'Северный ветер: монтаж в цехе', STAGE_ID: 'WON', company: 0, contact: 1, rows: [[3, 16]], begin: 60, close: -30 },
  { TITLE: 'Белое море: кабель (отказ)', STAGE_ID: 'LOSE', company: 3, contact: 5, rows: [[2, 5]], begin: 50, close: -20 },
  { TITLE: 'ТехноСтрой: обслуживание', STAGE_ID: 'NEW', company: 4, contact: 6, rows: [[5, 2]], begin: 1, close: 30 },
];

const WHOLESALE_DEALS = [
  { TITLE: 'Опт: Поморская логистика — 50 пушек', stage: 'NEW', company: 2, contact: 3, rows: [[0, 50]], begin: 3, close: 25 },
  { TITLE: 'Опт: Белое море Ритейл — генераторы', stage: 'WON', company: 3, contact: 4, rows: [[1, 20]], begin: 45, close: -15 },
];

const client = new Bitrix24Client({ webhookUrl: readWebhookUrl() });
const setDealProducts = productTools.find((tool) => tool.name === 'b24_deal_products_set');
const today = Date.now();

const existing = await client.call('crm.company.list', { filter: { TITLE: COMPANIES[0].TITLE }, select: ['ID'] });
if (existing.result.length > 0) {
  console.log('demo data already present, nothing to do');
  process.exit(0);
}

const me = (await client.call('profile')).result;
const userId = Number(me.ID);
if (!me.NAME) {
  await client.call('user.update', { ID: userId, NAME: 'Анна', LAST_NAME: 'Менеджерова', WORK_POSITION: 'Руководитель отдела продаж' });
}

const companyIds = [];
for (const company of COMPANIES) {
  const { PHONE, CITY, ...fields } = company;
  companyIds.push((await client.call('crm.company.add', {
    fields: { ...fields, COMPANY_TYPE: 'CUSTOMER', ADDRESS_CITY: CITY, PHONE: [{ VALUE: PHONE, VALUE_TYPE: 'WORK' }], ASSIGNED_BY_ID: userId },
  })).result);
}

const contactIds = [];
for (const contact of CONTACTS) {
  const { company, phone, email, ...fields } = contact;
  contactIds.push((await client.call('crm.contact.add', {
    fields: {
      ...fields,
      ...(company !== undefined && { COMPANY_ID: companyIds[company] }),
      PHONE: [{ VALUE: phone, VALUE_TYPE: 'MOBILE' }],
      EMAIL: [{ VALUE: email, VALUE_TYPE: 'WORK' }],
      ASSIGNED_BY_ID: userId,
    },
  })).result);
}

// A fresh portal has no base price type until someone opens the catalog settings, and crm.product.* drops PRICE without it.
const priceTypes = (await client.call('catalog.priceType.list', {})).result.priceTypes;
if (priceTypes.length === 0) {
  await client.call('catalog.priceType.add', { fields: { name: 'BASE', base: 'Y', sort: 100, xmlId: 'BASE' } });
}

const productIds = [];
for (const product of PRODUCTS) {
  productIds.push((await client.call('crm.product.add', { fields: { ...product, CURRENCY_ID: 'RUB', ACTIVE: 'Y' } })).result);
}

for (const lead of LEADS) {
  const { PHONE, EMAIL, ...fields } = lead;
  await client.call('crm.lead.add', {
    fields: {
      ...fields,
      CURRENCY_ID: 'RUB',
      ASSIGNED_BY_ID: userId,
      ...(PHONE && { PHONE: [{ VALUE: PHONE, VALUE_TYPE: 'MOBILE' }] }),
      ...(EMAIL && { EMAIL: [{ VALUE: EMAIL, VALUE_TYPE: 'WORK' }] }),
    },
  });
}

const wholesale = (await client.call('crm.category.add', { entityTypeId: 2, fields: { name: 'Оптовые продажи' } })).result.category;
const wholesaleStages = (await client.call('crm.status.list', {
  filter: { ENTITY_ID: `DEAL_STAGE_${wholesale.id}` },
  order: { SORT: 'ASC' },
})).result;
const wholesaleStage = (stage) => (stage === 'WON' ? wholesaleStages.find((s) => s.SEMANTICS === 'S') : wholesaleStages[0]).STATUS_ID;

const dealIds = [];
for (const deal of [...MAIN_DEALS, ...WHOLESALE_DEALS.map((d) => ({ ...d, CATEGORY_ID: wholesale.id, STAGE_ID: wholesaleStage(d.stage) }))]) {
  const { rows, company, contact, begin, close, stage, ...fields } = deal;
  const id = (await client.call('crm.deal.add', {
    fields: {
      ...fields,
      CURRENCY_ID: 'RUB',
      ASSIGNED_BY_ID: userId,
      ...(company !== undefined && { COMPANY_ID: companyIds[company] }),
      CONTACT_IDS: [contactIds[contact]],
      BEGINDATE: isoDate(today - begin * DAY_MS),
      CLOSEDATE: isoDate(today + close * DAY_MS),
    },
  })).result;
  await setDealProducts.run(client, {
    deal_id: id,
    rows: rows.map(([product, quantity]) => ({ PRODUCT_ID: productIds[product], PRICE: PRODUCTS[product].PRICE, QUANTITY: quantity })),
  });
  dealIds.push(id);
}

await client.call('crm.timeline.comment.add', {
  fields: { ENTITY_TYPE: 'deal', ENTITY_ID: dealIds[2], COMMENT: 'Клиент просит отсрочку оплаты на 2 недели, ждём решения директора.' },
});
await client.call('crm.activity.todo.add', {
  ownerTypeId: 2, ownerId: dealIds[1], title: 'Перезвонить Лебедеву по монтажу', description: '', deadline: new Date(today + DAY_MS).toISOString(),
});
await client.call('crm.activity.todo.add', {
  ownerTypeId: 2, ownerId: dealIds[2], title: 'Проверить оплату счёта', description: '', deadline: new Date(today - 2 * DAY_MS).toISOString(),
});

await client.call('tasks.task.add', {
  fields: { TITLE: 'Подготовить КП для Поморской логистики', RESPONSIBLE_ID: userId, DEADLINE: new Date(today - DAY_MS).toISOString(), UF_CRM_TASK: [`D_${dealIds[2]}`] },
});
await client.call('tasks.task.add', {
  fields: { TITLE: 'Согласовать график монтажа с ТехноСтроем', RESPONSIBLE_ID: userId, DEADLINE: new Date(today + 3 * DAY_MS).toISOString(), UF_CRM_TASK: [`D_${dealIds[4]}`] },
});

console.log(`seeded: ${companyIds.length} companies, ${contactIds.length} contacts, ${LEADS.length} leads, ${dealIds.length} deals, ${productIds.length} products`);

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
