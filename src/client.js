// Bitrix24 allows about 2 requests per second per portal; above that it answers QUERY_LIMIT_EXCEEDED.
// https://apidocs.bitrix24.com/limits.html
const MIN_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const RETRYABLE_ERRORS = new Set(['QUERY_LIMIT_EXCEEDED', 'OPERATION_TIME_LIMIT']);
export const METHOD_NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/i;

export const MAX_LIST_ITEMS = 2000;

export class Bitrix24Error extends Error {
  constructor(code, description) {
    super(description ? `${code}: ${description}` : code);
    this.name = 'Bitrix24Error';
    this.code = code;
  }
}

/**
 * REST client bound to one incoming webhook.
 * One instance per process: the throttle is per instance, and Bitrix24 counts requests per portal.
 */
export class Bitrix24Client {
  #baseUrl;
  #secretPath;
  #fetch;
  #sleep;
  #minIntervalMs;
  #nextSlotAt = 0;

  constructor({ webhookUrl, fetchImpl = fetch, sleep = defaultSleep, minIntervalMs = MIN_INTERVAL_MS }) {
    this.#baseUrl = webhookUrl;
    this.#secretPath = new URL(webhookUrl).pathname;
    this.#fetch = fetchImpl;
    this.#sleep = sleep;
    this.#minIntervalMs = minIntervalMs;
    this.portal = new URL(webhookUrl).hostname;
  }

  /** Calls one REST method and returns the whole response body: `{ result, total?, next?, time }`. */
  async call(method, params = {}) {
    if (!METHOD_NAME.test(method)) {
      throw new Bitrix24Error('INVALID_METHOD', `"${method}" is not a Bitrix24 REST method name`);
    }
    for (let attempt = 0; ; attempt++) {
      await this.#throttle();
      try {
        return await this.#post(method, params);
      } catch (error) {
        if (attempt >= MAX_RETRIES || !isRetryable(error)) {
          throw error;
        }
        await this.#sleep(RETRY_BASE_MS * 2 ** attempt);
      }
    }
  }

  /**
   * Walks a list method page by page until `next` runs out or MAX_LIST_ITEMS is reached.
   * `pickItems` extracts the array from `result`: list methods wrap it differently (`tasks`, `items`, bare array).
   */
  async listAll(method, params = {}, pickItems = pickArray) {
    const items = [];
    let start = 0;
    while (true) {
      const response = await this.call(method, { ...params, start });
      items.push(...pickItems(response.result));
      if (response.next === undefined || items.length >= MAX_LIST_ITEMS) {
        return { items: items.slice(0, MAX_LIST_ITEMS), total: response.total ?? items.length, truncated: response.next !== undefined };
      }
      start = response.next;
    }
  }

  /**
   * Masks the webhook path in text bound for the model.
   * Bitrix24 embeds it into some links it returns, e.g. Drive download URLs, and the path is the credential.
   */
  redact(text) {
    return text.replaceAll(this.#secretPath, '/rest/<webhook>/');
  }

  async #throttle() {
    const now = Date.now();
    const slot = Math.max(now, this.#nextSlotAt);
    this.#nextSlotAt = slot + this.#minIntervalMs;
    if (slot > now) {
      await this.#sleep(slot - now);
    }
  }

  async #post(method, params) {
    const response = await this.#fetch(`${this.#baseUrl}${method}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await readJson(response);
    if (body?.error) {
      throw new Bitrix24Error(String(body.error), body.error_description);
    }
    if (!response.ok || !body) {
      throw new Bitrix24Error(`HTTP_${response.status}`, response.statusText);
    }
    return body;
  }
}

export function pickArray(result) {
  return Array.isArray(result) ? result : [];
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

// Only errors where the portal rejected the call before running it: a retried timeout could create a deal twice.
function isRetryable(error) {
  return error instanceof Bitrix24Error && RETRYABLE_ERRORS.has(error.code);
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
