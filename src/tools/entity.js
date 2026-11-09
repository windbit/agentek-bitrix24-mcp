import { z } from 'zod';

const CLASSIC_ENTITIES = {
  lead: { typeId: 1, method: 'crm.lead' },
  deal: { typeId: 2, method: 'crm.deal' },
  contact: { typeId: 3, method: 'crm.contact' },
  company: { typeId: 4, method: 'crm.company' },
  quote: { typeId: 7, method: 'crm.quote' },
};

export const ENTITY_NAMES = Object.keys(CLASSIC_ENTITIES);

export const entityInput = {
  entity: z.enum(ENTITY_NAMES).optional().describe('CRM entity: lead, deal, contact, company or quote'),
  entity_type_id: z.number().int().positive().optional()
    .describe('Smart process type id (entityTypeId), instead of `entity`. See b24_crm_smart_process_types'),
};

/**
 * Picks the REST family for an entity.
 * Classic entities use crm.<entity>.* with UPPER_CASE fields; smart processes use crm.item.* with camelCase fields.
 */
export function resolveEntity({ entity, entity_type_id }) {
  if (entity && entity_type_id) {
    throw new Error('Pass either `entity` or `entity_type_id`, not both');
  }
  if (entity) {
    return { kind: 'classic', name: entity, ...CLASSIC_ENTITIES[entity] };
  }
  if (entity_type_id) {
    return { kind: 'item', name: `smart_process_${entity_type_id}`, typeId: entity_type_id, method: 'crm.item' };
  }
  throw new Error('Pass `entity` (lead, deal, contact, company, quote) or `entity_type_id` for a smart process');
}

export function entityTypeIdOf(target) {
  return resolveEntity(target).typeId;
}
