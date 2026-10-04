import { z } from 'zod';

/**
 * Contact contracts.
 *
 * NOTE: contacts use `firstNames`/`lastNames` (plural) — unlike users, whose
 * columns are `firstName`/`lastName`. The contracts keep each domain honest.
 */
export const CONTACT_STATUSES = ['new', 'lead', 'prospect', 'client'] as const;
export const ContactStatusSchema = z.enum(CONTACT_STATUSES);

export const CONTACT_SOURCES = ['whatsapp', 'manual'] as const;
export const ContactSourceSchema = z.enum(CONTACT_SOURCES);

/** Payload accepted by `POST /contacts` / `PATCH /contacts/:id`. */
export const CreateContactSchema = z.object({
  waId: z.string().optional(),
  username: z.string().optional(),
  phoneNumber: z.string(),
  email: z.string().optional(),
});

export const UpdateContactSchema = CreateContactSchema.partial();

/** Entity shape returned by the contacts endpoints. */
export const ContactResponseSchema = z.object({
  id: z.string(),
  waId: z.string().nullish(),
  firstNames: z.string().nullish(),
  lastNames: z.string().nullish(),
  username: z.string().nullish(),
  profile: z.string().nullish(),
  phoneNumber: z.string(),
  email: z.string().nullish(),
  status: ContactStatusSchema,
  source: ContactSourceSchema,
  lastInteractionAt: z.coerce.date().nullish(),
  tags: z.array(z.string()).nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type ContactStatus = z.infer<typeof ContactStatusSchema>;
export type ContactSource = z.infer<typeof ContactSourceSchema>;
export type CreateContactInput = z.infer<typeof CreateContactSchema>;
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;
export type ContactResponse = z.infer<typeof ContactResponseSchema>;
