import { z } from 'zod';

import { pickArray } from '../client.js';

export const READ = { readOnlyHint: true, openWorldHint: true };
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

export const idInput = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).describe('Record id');

/** Shapes one page of a list method: items plus the offset of the next page, if any. */
export function listOutput(response, pickItems = pickArray) {
  return { items: pickItems(response.result), total: response.total, next: response.next };
}
