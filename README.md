# agentek-bitrix24-mcp

**MCP server that gives an AI agent access to a Bitrix24 portal through an incoming webhook.** The agent works with CRM (leads, deals, contacts, companies, smart processes, pipelines, activities), products and deal product rows, tasks, employees, calendar, Drive, messenger, Feed, telephony history and business processes. For anything else it can call any REST method directly.

The server runs over stdio and needs one environment variable, the webhook URL:

```json
{
  "mcpServers": {
    "bitrix24": {
      "command": "npx",
      "args": ["-y", "agentek-bitrix24-mcp"],
      "env": { "BITRIX24_WEBHOOK_URL": "https://your-portal.bitrix24.ru/rest/1/your-code/" }
    }
  }
}
```

It is a fork of [bit2beat/bitrix24-mcp](https://github.com/bit2beat/bitrix24-mcp), maintained by [Agentek](https://agentek.ru) for its agent platform.

## Creating the webhook

A portal administrator creates the webhook in **Developer resources → Other → Incoming webhook**. Bitrix24 opens webhooks only with the Marketplace subscription (the "BitrixGPT + Marketplace" bundle on bitrix24.ru); a demo period of it is enough for a trial.

Grant the scopes the agent needs: `crm`, `task`, `user`, `department`, `calendar`, `disk`, `im`, `log`, `sonet_group`, `bizproc`, `telephony`. A missing scope only disables its tools; `b24_check_connection` shows what the webhook has. The webhook acts as the user who created it, so the agent sees and changes what that user can.

**The webhook URL is a credential.** Its path carries the secret code, so keep it out of chats and logs. The server masks that path in every answer it returns, including links Bitrix24 builds on it.

## Tools

| Area | Tools |
|------|-------|
| Connection and raw API | `b24_check_connection`, `b24_call`, `b24_batch` |
| CRM records | `b24_crm_list`, `b24_crm_get`, `b24_crm_create`, `b24_crm_update`, `b24_crm_delete`, `b24_crm_fields` |
| Sales process | `b24_crm_pipelines`, `b24_crm_find_duplicates`, `b24_crm_smart_process_types`, `b24_crm_timeline_comment_add`, `b24_crm_activity_list`, `b24_crm_todo_add` |
| Products | `b24_products_list`, `b24_products_get`, `b24_products_create`, `b24_products_update`, `b24_products_sections`, `b24_deal_products_get`, `b24_deal_products_set` |
| Tasks | `b24_tasks_list`, `b24_tasks_get`, `b24_tasks_create`, `b24_tasks_update`, `b24_tasks_complete`, `b24_tasks_comment_add` |
| Company | `b24_users_list`, `b24_departments_list`, `b24_groups_list`, `b24_calendar_events`, `b24_calendar_event_add` |
| Drive | `b24_disk_storages`, `b24_disk_folder_list`, `b24_disk_file_get`, `b24_disk_file_upload` |
| Communication | `b24_chat_send`, `b24_notify_send`, `b24_feed_post`, `b24_calls_list`, `b24_workflow_templates`, `b24_workflow_start` |

The client keeps to the portal rate limit of two requests per second and retries only calls the portal rejected for exceeding it, so a write is never sent twice. List tools return one page with the `next` offset; `all_pages` fetches up to 2000 records.

## Development

```bash
npm install
npm test
BITRIX24_WEBHOOK_URL=... node scripts/seed-demo.mjs   # fill an empty test portal with a small sales department
```

Releases go out from a `v*` tag that matches `version` in `package.json`: CI runs the tests and publishes the package to npm.
