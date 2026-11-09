import { z } from 'zod';

import { READ, WRITE, idInput, listOutput } from './shared.js';

const DEFAULT_TASK_FIELDS = ['ID', 'TITLE', 'STATUS', 'PRIORITY', 'RESPONSIBLE_ID', 'CREATED_BY', 'DEADLINE', 'GROUP_ID', 'UF_CRM_TASK'];
const pickTasks = (result) => result.tasks;

export const taskTools = [
  {
    name: 'b24_tasks_list',
    description:
      'List tasks with filter and sorting. Status codes: 2 — pending, 3 — in progress, 4 — awaiting control, 5 — completed, 6 — deferred. ' +
      'Filter examples: { "RESPONSIBLE_ID": 5, "REAL_STATUS": [2, 3] }, overdue — { "<DEADLINE": "2026-11-09T00:00:00+03:00", "!REAL_STATUS": 5 }, ' +
      'linked to a deal — { "UF_CRM_TASK": "D_123" } (L_ lead, C_ contact, CO_ company).',
    annotations: READ,
    input: {
      filter: z.record(z.any()).optional(),
      select: z.array(z.string()).optional().describe(`Fields to return; default ${DEFAULT_TASK_FIELDS.join(', ')}`),
      order: z.record(z.enum(['ASC', 'DESC', 'asc', 'desc'])).optional().describe('Sorting, default { "DEADLINE": "ASC" }'),
      start: z.number().int().nonnegative().optional().describe('Offset for the next page: the `next` value of the previous call'),
      all_pages: z.boolean().optional().describe('Fetch every page (capped at 2000 tasks)'),
    },
    run: async (client, args) => {
      const params = {
        filter: args.filter ?? {},
        select: args.select ?? DEFAULT_TASK_FIELDS,
        order: args.order ?? { DEADLINE: 'ASC' },
      };
      if (args.all_pages) {
        return client.listAll('tasks.task.list', params, pickTasks);
      }
      return listOutput(await client.call('tasks.task.list', { ...params, start: args.start ?? 0 }), pickTasks);
    },
  },
  {
    name: 'b24_tasks_get',
    description: 'Get one task with description, participants, deadline and CRM links.',
    annotations: READ,
    input: { id: idInput },
    run: async (client, { id }) => {
      const { result } = await client.call('tasks.task.get', { taskId: id });
      return result.task;
    },
  },
  {
    name: 'b24_tasks_create',
    description:
      'Create a task. Fields: TITLE (required), DESCRIPTION, RESPONSIBLE_ID, DEADLINE (ISO 8601 with offset), PRIORITY (2 — high, 1 — normal), ' +
      'GROUP_ID, ACCOMPLICES, AUDITORS, UF_CRM_TASK (CRM links, e.g. ["D_123", "C_45"]).',
    annotations: WRITE,
    input: { fields: z.record(z.any()).describe('Task fields; TITLE is required') },
    run: async (client, { fields }) => {
      const { result } = await client.call('tasks.task.add', { fields });
      return { id: result.task.id };
    },
  },
  {
    name: 'b24_tasks_update',
    description: 'Update task fields. Only the passed fields change.',
    annotations: WRITE,
    input: { id: idInput, fields: z.record(z.any()) },
    run: async (client, { id, fields }) => {
      await client.call('tasks.task.update', { taskId: id, fields });
      return { id, updated: true };
    },
  },
  {
    name: 'b24_tasks_complete',
    description: 'Mark a task as completed.',
    annotations: WRITE,
    input: { id: idInput },
    run: async (client, { id }) => {
      await client.call('tasks.task.complete', { taskId: id });
      return { id, completed: true };
    },
  },
  {
    name: 'b24_tasks_comment_add',
    description: 'Add a comment to a task.',
    annotations: WRITE,
    input: { id: idInput, text: z.string().min(1) },
    run: async (client, { id, text }) => {
      const { result } = await client.call('task.commentitem.add', { TASKID: id, FIELDS: { POST_MESSAGE: text } });
      return { comment_id: result };
    },
  },
];
