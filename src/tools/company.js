import { z } from 'zod';

import { READ, WRITE, idInput, listOutput } from './shared.js';

const DEFAULT_USER_FIELDS = ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'WORK_POSITION', 'UF_DEPARTMENT', 'IS_ONLINE', 'LAST_ACTIVITY_DATE'];
const CALENDAR_TYPES = ['user', 'group', 'company_calendar'];

export const companyTools = [
  {
    name: 'b24_users_list',
    description:
      'List employees of the portal: id, name, email, position, department ids. Use it to map a manager\'s name to ASSIGNED_BY_ID / RESPONSIBLE_ID.',
    annotations: READ,
    input: {
      filter: z.record(z.any()).optional().describe('Filter, default { "ACTIVE": true }; e.g. { "UF_DEPARTMENT": 5 } or { "%LAST_NAME": "Petrov" }'),
      select: z.array(z.string()).optional(),
    },
    run: async (client, args) => {
      const pickUsers = (result) => result.map((user) => pickFields(user, args.select ?? DEFAULT_USER_FIELDS));
      return client.listAll('user.get', { FILTER: args.filter ?? { ACTIVE: true } }, pickUsers);
    },
  },
  {
    name: 'b24_departments_list',
    description: 'List departments of the company structure with parent department and head (UF_HEAD).',
    annotations: READ,
    input: {},
    run: (client) => client.listAll('department.get', {}),
  },
  {
    name: 'b24_groups_list',
    description: 'List workgroups and projects.',
    annotations: READ,
    input: { filter: z.record(z.any()).optional().describe('e.g. { "ACTIVE": "Y", "PROJECT": "Y" }') },
    run: (client, { filter }) => client.listAll('sonet_group.get', { FILTER: filter ?? {} }),
  },
  {
    name: 'b24_calendar_events',
    description: 'List calendar events of a user, a workgroup or the company calendar for a period.',
    annotations: READ,
    input: {
      type: z.enum(CALENDAR_TYPES).optional().describe('user (default), group or company_calendar'),
      owner_id: z.number().int().positive().optional().describe('User or group id; default — the webhook user'),
      from: z.string().describe('Period start, YYYY-MM-DD'),
      to: z.string().describe('Period end, YYYY-MM-DD'),
    },
    run: async (client, args) => {
      const type = args.type ?? 'user';
      const { result } = await client.call('calendar.event.get', {
        type,
        ownerId: await calendarOwner(client, type, args.owner_id),
        from: args.from,
        to: args.to,
      });
      return result;
    },
  },
  {
    name: 'b24_calendar_event_add',
    description: 'Create a calendar event, e.g. a meeting with a client, and invite employees.',
    annotations: WRITE,
    input: {
      type: z.enum(CALENDAR_TYPES).optional(),
      owner_id: z.number().int().positive().optional().describe('User or group id; default — the webhook user'),
      name: z.string().min(1),
      from: z.string().describe('Start, e.g. "2026-11-12 10:00"'),
      to: z.string().describe('End, e.g. "2026-11-12 11:00"'),
      timezone: z.string().optional().describe('IANA timezone of from/to, e.g. "Europe/Moscow"; default — the owner\'s timezone'),
      description: z.string().optional(),
      location: z.string().optional(),
      attendees: z.array(z.number().int().positive()).optional().describe('User ids to invite'),
    },
    run: async (client, args) => {
      const type = args.type ?? 'user';
      const ownerId = await calendarOwner(client, type, args.owner_id);
      const { result } = await client.call('calendar.event.add', {
        type,
        ownerId,
        name: args.name,
        from: args.from,
        to: args.to,
        ...(args.timezone && { timezone_from: args.timezone, timezone_to: args.timezone }),
        ...(args.description && { description: args.description }),
        ...(args.location && { location: args.location }),
        ...(args.attendees && { is_meeting: 'Y', attendees: [ownerId, ...args.attendees], host: ownerId }),
      });
      return { event_id: result };
    },
  },
  {
    name: 'b24_disk_storages',
    description: 'List Drive storages: personal, workgroup and company storages with their root folder ids.',
    annotations: READ,
    input: {},
    run: (client) => client.listAll('disk.storage.getlist', {}),
  },
  {
    name: 'b24_disk_folder_list',
    description: 'List files and subfolders of a Drive folder. Pass the ROOT_OBJECT_ID of a storage to browse it from the top.',
    annotations: READ,
    input: { folder_id: idInput, start: z.number().int().nonnegative().optional() },
    run: async (client, { folder_id, start }) => {
      const response = await client.call('disk.folder.getchildren', { id: folder_id, start: start ?? 0 });
      const page = listOutput(response);
      return {
        ...page,
        items: page.items.map((item) => ({
          id: item.ID,
          name: item.NAME,
          type: item.TYPE,
          size: item.SIZE,
          updated_at: item.UPDATE_TIME,
          url: item.DETAIL_URL,
        })),
      };
    },
  },
  {
    name: 'b24_disk_file_get',
    description: 'Get Drive file details: name, size, folder, author, dates and a link to open it in Bitrix24.',
    annotations: READ,
    input: { file_id: idInput },
    run: async (client, { file_id }) => {
      // DOWNLOAD_URL is built on the webhook path, so it would hand the credential to whoever reads the answer.
      const { DOWNLOAD_URL: _downloadUrl, ...file } = (await client.call('disk.file.get', { id: file_id })).result;
      return file;
    },
  },
  {
    name: 'b24_disk_file_upload',
    description: 'Upload a small file (base64) into a Drive folder.',
    annotations: WRITE,
    input: {
      folder_id: idInput,
      name: z.string().min(1).describe('File name with extension'),
      content_base64: z.string().min(1),
    },
    run: async (client, { folder_id, name, content_base64 }) => {
      const { result } = await client.call('disk.folder.uploadfile', {
        id: folder_id,
        data: { NAME: name },
        fileContent: [name, content_base64],
        generateUniqueName: true,
      });
      return { id: result.ID, name: result.NAME, url: result.DETAIL_URL };
    },
  },
];

async function calendarOwner(client, type, ownerId) {
  if (type === 'company_calendar') {
    return '';
  }
  if (ownerId) {
    return ownerId;
  }
  if (type === 'group') {
    throw new Error('owner_id (workgroup id) is required for a group calendar');
  }
  const { result } = await client.call('profile');
  return Number(result.ID);
}

function pickFields(record, fields) {
  return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
}
