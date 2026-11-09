import { z } from 'zod';

import { entityInput, entityTypeIdOf, resolveEntity } from './entity.js';
import { READ, WRITE, DESTRUCTIVE, idInput, listOutput } from './shared.js';

const STAGE_SEMANTICS = { S: 'won', F: 'lost' };

export const crmTools = [
  {
    name: 'b24_crm_list',
    description:
      'List CRM records (leads, deals, contacts, companies, quotes or smart process items) with filter, field selection and sorting. ' +
      'Classic entities use UPPER_CASE fields (filter { "STAGE_ID": "WON", ">=DATE_CREATE": "2026-01-01" }), ' +
      'smart processes use camelCase (filter { "stageId": "DT128_1:NEW" }). Returns one page of 50 unless all_pages is set.',
    annotations: READ,
    input: {
      ...entityInput,
      filter: z.record(z.any()).optional().describe('Filter. Prefix a field with >, <, >=, <=, ! or % for comparisons and substring search'),
      select: z.array(z.string()).optional().describe('Fields to return, e.g. ["ID","TITLE","STAGE_ID","OPPORTUNITY","ASSIGNED_BY_ID"]. "UF_*" adds custom fields'),
      order: z.record(z.enum(['ASC', 'DESC', 'asc', 'desc'])).optional().describe('Sorting, e.g. { "DATE_CREATE": "DESC" }'),
      start: z.number().int().nonnegative().optional().describe('Offset for the next page: the `next` value of the previous call'),
      all_pages: z.boolean().optional().describe('Fetch every page (capped at 2000 records)'),
    },
    run: crmList,
  },
  {
    name: 'b24_crm_get',
    description: 'Get one CRM record with all its fields by id.',
    annotations: READ,
    input: { ...entityInput, id: idInput },
    run: async (client, args) => {
      const target = resolveEntity(args);
      const params = target.kind === 'item' ? { entityTypeId: target.typeId, id: args.id } : { id: args.id };
      const { result } = await client.call(`${target.method}.get`, params);
      return target.kind === 'item' ? result.item : result;
    },
  },
  {
    name: 'b24_crm_create',
    description:
      'Create a CRM record. Deal example: { "TITLE": "Website order", "CATEGORY_ID": 0, "STAGE_ID": "NEW", "OPPORTUNITY": 50000, ' +
      '"CURRENCY_ID": "RUB", "CONTACT_ID": 12, "ASSIGNED_BY_ID": 1 }. Contact example: { "NAME": "Ivan", "LAST_NAME": "Petrov", ' +
      '"PHONE": [{ "VALUE": "+79001234567", "VALUE_TYPE": "WORK" }], "EMAIL": [{ "VALUE": "ivan@example.com", "VALUE_TYPE": "WORK" }] }. ' +
      'Check field codes with b24_crm_fields and stage ids with b24_crm_pipelines first.',
    annotations: WRITE,
    input: {
      ...entityInput,
      fields: z.record(z.any()).describe('Field values of the new record'),
    },
    run: async (client, args) => {
      const target = resolveEntity(args);
      const params = target.kind === 'item'
        ? { entityTypeId: target.typeId, fields: args.fields }
        : { fields: args.fields, params: { REGISTER_SONET_EVENT: 'Y' } };
      const { result } = await client.call(`${target.method}.add`, params);
      return { id: target.kind === 'item' ? result.item.id : result };
    },
  },
  {
    name: 'b24_crm_update',
    description:
      'Update fields of a CRM record. Only the passed fields change. To move a deal to another stage pass { "STAGE_ID": "<stage id>" }; ' +
      'stage ids come from b24_crm_pipelines. Multi-value fields (PHONE, EMAIL) need the existing item ID to edit a value, otherwise a value is added.',
    annotations: WRITE,
    input: { ...entityInput, id: idInput, fields: z.record(z.any()).describe('Fields to change') },
    run: async (client, args) => {
      const target = resolveEntity(args);
      const params = target.kind === 'item'
        ? { entityTypeId: target.typeId, id: args.id, fields: args.fields }
        : { id: args.id, fields: args.fields, params: { REGISTER_SONET_EVENT: 'Y' } };
      await client.call(`${target.method}.update`, params);
      return { id: args.id, updated: true };
    },
  },
  {
    name: 'b24_crm_delete',
    description: 'Delete a CRM record permanently. Ask the user for confirmation before calling.',
    annotations: DESTRUCTIVE,
    input: { ...entityInput, id: idInput },
    run: async (client, args) => {
      const target = resolveEntity(args);
      const params = target.kind === 'item' ? { entityTypeId: target.typeId, id: args.id } : { id: args.id };
      await client.call(`${target.method}.delete`, params);
      return { id: args.id, deleted: true };
    },
  },
  {
    name: 'b24_crm_fields',
    description:
      'Describe the fields of a CRM entity: code, type, title, whether it is required or read-only, list values. ' +
      'Includes custom UF_* fields with their portal titles. Call before creating or filtering by unfamiliar fields.',
    annotations: READ,
    input: entityInput,
    run: async (client, args) => {
      const target = resolveEntity(args);
      const params = target.kind === 'item' ? { entityTypeId: target.typeId } : {};
      const { result } = await client.call(`${target.method}.fields`, params);
      return target.kind === 'item' ? result.fields : result;
    },
  },
  {
    name: 'b24_crm_pipelines',
    description:
      'List sales pipelines (deal categories) with their stages, or lead statuses, or smart process funnels. ' +
      'Each stage has its id (use it as STAGE_ID / STATUS_ID), name, order and outcome: in_progress, won or lost.',
    annotations: READ,
    input: {
      entity: z.enum(['deal', 'lead']).optional().describe('deal (default) or lead'),
      entity_type_id: entityInput.entity_type_id,
    },
    run: crmPipelines,
  },
  {
    name: 'b24_crm_find_duplicates',
    description:
      'Find leads, contacts and companies by phone number or email. Use it to look up a client before creating a new record. ' +
      'Returns ids grouped by entity; fetch details with b24_crm_get.',
    annotations: READ,
    input: {
      type: z.enum(['PHONE', 'EMAIL']),
      values: z.array(z.string()).min(1).max(20).describe('Phone numbers or emails to look for'),
      entity_type: z.enum(['LEAD', 'CONTACT', 'COMPANY']).optional().describe('Limit the search to one entity'),
    },
    run: async (client, { type, values, entity_type }) => {
      const { result } = await client.call('crm.duplicate.findbycomm', { type, values, ...(entity_type && { entity_type }) });
      return Array.isArray(result) ? {} : result;
    },
  },
  {
    name: 'b24_crm_smart_process_types',
    description: 'List smart process types of the portal with their entityTypeId and title.',
    annotations: READ,
    input: {},
    run: async (client) => {
      const { items } = await client.listAll('crm.type.list', {}, (result) => result.types);
      return items.map((type) => ({ entity_type_id: type.entityTypeId, title: type.title, is_categories_enabled: type.isCategoriesEnabled }));
    },
  },
  {
    name: 'b24_crm_timeline_comment_add',
    description: 'Add a comment to the timeline of a CRM record, e.g. a call summary or a note for the manager.',
    annotations: WRITE,
    input: { ...entityInput, id: idInput, comment: z.string().min(1).describe('Comment text, BB-code allowed') },
    run: async (client, args) => {
      const target = resolveEntity(args);
      const { result } = await client.call('crm.timeline.comment.add', {
        fields: { ENTITY_ID: args.id, ENTITY_TYPE: timelineEntityType(target), COMMENT: args.comment },
      });
      return { comment_id: result };
    },
  },
  {
    name: 'b24_crm_activity_list',
    description:
      'List activities of a CRM record: calls, emails, meetings, to-dos, open-line chats. Shows the communication history with a client.',
    annotations: READ,
    input: {
      ...entityInput,
      id: idInput,
      completed: z.boolean().optional().describe('true — only completed, false — only open activities'),
    },
    run: async (client, args) => {
      const filter = { OWNER_TYPE_ID: entityTypeIdOf(args), OWNER_ID: args.id };
      if (args.completed !== undefined) {
        filter.COMPLETED = args.completed ? 'Y' : 'N';
      }
      const { result, total } = await client.call('crm.activity.list', {
        filter,
        order: { ID: 'DESC' },
        select: ['ID', 'TYPE_ID', 'PROVIDER_ID', 'SUBJECT', 'DESCRIPTION', 'DIRECTION', 'COMPLETED', 'DEADLINE', 'CREATED', 'RESPONSIBLE_ID'],
      });
      return { total, activities: result };
    },
  },
  {
    name: 'b24_crm_todo_add',
    description:
      'Schedule a to-do on a CRM record for a manager: call back, send an offer, follow up. It appears in the record and in the manager\'s list.',
    annotations: WRITE,
    input: {
      ...entityInput,
      id: idInput,
      title: z.string().min(1).describe('Short title, e.g. "Call back about the offer"'),
      description: z.string().optional(),
      deadline: z.string().describe('Due date and time in ISO 8601 with offset, e.g. "2026-11-12T15:00:00+03:00"'),
      responsible_id: z.number().int().positive().optional().describe('User id of the manager; default — the webhook user'),
    },
    run: async (client, args) => {
      const { result } = await client.call('crm.activity.todo.add', {
        ownerTypeId: entityTypeIdOf(args),
        ownerId: args.id,
        title: args.title,
        description: args.description ?? '',
        deadline: args.deadline,
        ...(args.responsible_id && { responsibleId: args.responsible_id }),
      });
      return { activity_id: result.id };
    },
  },
];

async function crmList(client, args) {
  const target = resolveEntity(args);
  const params = {
    ...(target.kind === 'item' && { entityTypeId: target.typeId }),
    filter: args.filter ?? {},
    ...(args.select && { select: args.select }),
    ...(args.order && { order: args.order }),
  };
  const pickItems = target.kind === 'item' ? (result) => result.items : undefined;
  if (args.all_pages) {
    return client.listAll(`${target.method}.list`, params, pickItems);
  }
  const response = await client.call(`${target.method}.list`, { ...params, start: args.start ?? 0 });
  return listOutput(response, pickItems);
}

async function crmPipelines(client, { entity, entity_type_id }) {
  if (entity_type_id) {
    return funnelsWithStages(client, entity_type_id, (categoryId) => `DYNAMIC_${entity_type_id}_STAGE_${categoryId}`);
  }
  if (entity === 'lead') {
    return [{ name: 'Leads', stages: await stagesOf(client, 'STATUS') }];
  }
  return funnelsWithStages(client, 2, (categoryId) => (categoryId === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${categoryId}`));
}

async function funnelsWithStages(client, entityTypeId, stageEntityId) {
  const { result } = await client.call('crm.category.list', { entityTypeId });
  const funnels = [];
  for (const category of result.categories) {
    funnels.push({
      id: category.id,
      name: category.name,
      is_default: category.isDefault === 'Y',
      stages: await stagesOf(client, stageEntityId(category.id)),
    });
  }
  return funnels;
}

async function stagesOf(client, entityId) {
  const { result } = await client.call('crm.status.list', { filter: { ENTITY_ID: entityId }, order: { SORT: 'ASC' } });
  return result.map((stage) => ({
    id: stage.STATUS_ID,
    name: stage.NAME,
    sort: Number(stage.SORT),
    outcome: STAGE_SEMANTICS[stage.SEMANTICS] ?? 'in_progress',
  }));
}

function timelineEntityType(target) {
  return target.kind === 'item' ? `dynamic_${target.typeId}` : target.name;
}
