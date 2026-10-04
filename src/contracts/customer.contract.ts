import { z } from 'zod';

/**
 * Customer contracts (v2). `customer_identities` is the resolution canon;
 * `customers.phone_number` is informational and normalized to `+digits`.
 */
export const CUSTOMER_SOURCES = ['whatsapp', 'manual', 'import', 'api'] as const;
export const CustomerSourceSchema = z.enum(CUSTOMER_SOURCES);
export type CustomerSource = z.infer<typeof CustomerSourceSchema>;

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multiselect',
] as const;
export const CustomFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;
