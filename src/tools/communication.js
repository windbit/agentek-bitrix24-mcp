import { z } from 'zod';

import { READ, WRITE, idInput, listOutput } from './shared.js';

export const communicationTools = [
  {
    name: 'b24_chat_send',
    description: 'Send a message to an employee or a group chat in the Bitrix24 messenger.',
    annotations: WRITE,
    input: {
      dialog_id: z.string().regex(/^(chat)?\d+$/).describe('User id for a private message, or "chat<id>" for a group chat'),
      message: z.string().min(1).describe('Message text, BB-code allowed'),
    },
    run: async (client, { dialog_id, message }) => {
      const { result } = await client.call('im.message.add', { DIALOG_ID: dialog_id, MESSAGE: message });
      return { message_id: result };
    },
  },
  {
    name: 'b24_notify_send',
    description: 'Send a personal notification to an employee (the bell in Bitrix24).',
    annotations: WRITE,
    input: { user_id: idInput, message: z.string().min(1) },
    run: async (client, { user_id, message }) => {
      const { result } = await client.call('im.notify.personal.add', { USER_ID: user_id, MESSAGE: message });
      return { notification_id: result };
    },
  },
  {
    name: 'b24_feed_post',
    description: 'Publish a post to the activity stream (Feed).',
    annotations: WRITE,
    input: {
      message: z.string().min(1).describe('Post text, BB-code allowed'),
      title: z.string().optional(),
      recipients: z.array(z.string().regex(/^(UA|U\d+|SG\d+|DR\d+)$/)).optional()
        .describe('Audience: "UA" — all employees (default), "U<id>" — user, "SG<id>" — workgroup, "DR<id>" — department with subdepartments'),
    },
    run: async (client, { message, title, recipients }) => {
      const { result } = await client.call('log.blogpost.add', {
        POST_MESSAGE: message,
        ...(title && { POST_TITLE: title }),
        DEST: recipients ?? ['UA'],
      });
      return { post_id: result };
    },
  },
  {
    name: 'b24_calls_list',
    description:
      'List telephony calls with duration, direction, employee and linked CRM record. ' +
      'Filter example: { ">=CALL_START_DATE": "2026-11-01T00:00:00+03:00", "PORTAL_USER_ID": 5 }. CALL_TYPE: 1 — outgoing, 2 — incoming.',
    annotations: READ,
    input: {
      filter: z.record(z.any()).optional(),
      start: z.number().int().nonnegative().optional(),
    },
    run: async (client, { filter, start }) => {
      const response = await client.call('voximplant.statistic.get', {
        FILTER: filter ?? {},
        SORT: 'CALL_START_DATE',
        ORDER: 'DESC',
        start: start ?? 0,
      });
      return listOutput(response);
    },
  },
  {
    name: 'b24_workflow_templates',
    description: 'List business process templates, optionally for one CRM entity, to find TEMPLATE_ID for b24_workflow_start.',
    annotations: READ,
    input: {
      document_type: z.enum(['CCrmDocumentLead', 'CCrmDocumentDeal', 'CCrmDocumentContact', 'CCrmDocumentCompany']).optional(),
    },
    run: (client, { document_type }) => client.listAll('bizproc.workflow.template.list', {
      select: ['ID', 'NAME', 'DESCRIPTION', 'DOCUMENT_TYPE', 'AUTO_EXECUTE'],
      filter: document_type ? { DOCUMENT_TYPE: ['crm', document_type, document_type.replace('CCrmDocument', '').toUpperCase()] } : {},
    }),
  },
  {
    name: 'b24_workflow_start',
    description: 'Start a business process on a CRM record.',
    annotations: WRITE,
    input: {
      template_id: idInput,
      document_type: z.enum(['CCrmDocumentLead', 'CCrmDocumentDeal', 'CCrmDocumentContact', 'CCrmDocumentCompany']),
      record_id: idInput,
      parameters: z.record(z.any()).optional().describe('Template parameters, if the template declares any'),
    },
    run: async (client, args) => {
      const entityCode = args.document_type.replace('CCrmDocument', '').toUpperCase();
      const { result } = await client.call('bizproc.workflow.start', {
        TEMPLATE_ID: args.template_id,
        DOCUMENT_ID: ['crm', args.document_type, `${entityCode}_${args.record_id}`],
        PARAMETERS: args.parameters ?? {},
      });
      return { workflow_id: result };
    },
  },
];
