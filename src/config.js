const WEBHOOK_PATH = /^\/rest\/\d+\/[^/]+\/?$/;
const WEBHOOK_SHAPE_HINT = 'https://<portal>.bitrix24.ru/rest/<user_id>/<code>/';

/**
 * Reads the incoming webhook URL from the environment and normalizes it to end with `/`.
 * Throws on a missing or malformed value; the message never echoes the URL — its path is the secret.
 */
export function readWebhookUrl(env = process.env) {
  const raw = env.BITRIX24_WEBHOOK_URL?.trim();
  if (!raw) {
    throw new Error(`BITRIX24_WEBHOOK_URL is not set; expected ${WEBHOOK_SHAPE_HINT}`);
  }
  if (!URL.canParse(raw)) {
    throw new Error(`BITRIX24_WEBHOOK_URL is not a valid URL; expected ${WEBHOOK_SHAPE_HINT}`);
  }
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !WEBHOOK_PATH.test(url.pathname) || url.search || url.hash) {
    throw new Error(`BITRIX24_WEBHOOK_URL has an unexpected shape; expected ${WEBHOOK_SHAPE_HINT}`);
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}
