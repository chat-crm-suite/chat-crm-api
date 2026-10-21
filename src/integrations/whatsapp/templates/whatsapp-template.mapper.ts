// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  TEMPLATE_HEADER_FORMATS,
  templateParamKey,
  type TemplateCategory,
  type TemplateComponent,
  type TemplateComponentType,
  type TemplateStatus,
} from '@contracts';
import type {
  ResolvedTemplate,
  TemplateParameter,
} from '@modules/channels/ports/channel-adapter.port';
import type {
  RemoteTemplate,
  RemoteTemplateVariable,
  SendableTemplate,
} from '@modules/channels/ports/channel-template.port';
import type {
  WhatsAppGraphTemplate,
  WhatsAppGraphTemplateComponent,
} from '../clients/whatsapp.client';

/** Graph template statuses -> the neutral lifecycle. */
const STATUS: Record<string, TemplateStatus> = {
  APPROVED: 'approved',
  PENDING: 'pending',
  IN_APPEAL: 'pending',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  DELETED: 'disabled',
  PENDING_DELETION: 'disabled',
  LIMIT_EXCEEDED: 'disabled',
  ARCHIVED: 'disabled',
};

const CATEGORY: Record<string, TemplateCategory> = {
  MARKETING: 'marketing',
  UTILITY: 'utility',
  AUTHENTICATION: 'authentication',
};

const BUTTON_TYPES = {
  QUICK_REPLY: 'quick_reply',
  URL: 'url',
  PHONE_NUMBER: 'phone_number',
  COPY_CODE: 'copy_code',
} as const;

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Placeholder keys of a text, in order of first appearance. */
export function placeholderKeys(text: string | null | undefined): string[] {
  if (!text) return [];
  const keys: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

/** One Graph template as the neutral `RemoteTemplate` (components + variables). */
export function normalizeWhatsAppTemplate(template: WhatsAppGraphTemplate): RemoteTemplate {
  const status = STATUS[(template.status ?? '').toUpperCase()] ?? 'pending';
  const components: TemplateComponent[] = [];
  const variables: RemoteTemplateVariable[] = [];

  for (const component of template.components ?? []) {
    const type = component.type?.toUpperCase();
    if (type === 'HEADER') {
      const format = component.format?.toLowerCase();
      components.push({
        type: 'header',
        format: isHeaderFormat(format) ? format : null,
        text: component.text ?? null,
      });
      variables.push(...textVariables('header', component));
    } else if (type === 'BODY') {
      components.push({ type: 'body', text: component.text ?? null });
      variables.push(...textVariables('body', component));
    } else if (type === 'FOOTER') {
      components.push({ type: 'footer', text: component.text ?? null });
    } else if (type === 'BUTTONS') {
      const buttons = component.buttons ?? [];
      components.push({
        type: 'buttons',
        buttons: buttons.map((button) => ({
          type:
            BUTTON_TYPES[button.type?.toUpperCase() as keyof typeof BUTTON_TYPES] ?? 'other',
          text: button.text ?? '',
          url: button.url ?? null,
          phoneNumber: button.phone_number ?? null,
        })),
      });
      // A dynamic URL button takes one value: the suffix of `{{1}}`.
      buttons.forEach((button, index) => {
        if (button.type?.toUpperCase() !== 'URL' || !placeholderKeys(button.url).length) return;
        variables.push({
          key: String(index),
          component: 'buttons',
          example: button.example?.[0] ?? null,
        });
      });
    } else if (type === 'CAROUSEL') {
      // Kept so the template reads as unsendable; its cards are not stored.
      components.push({ type: 'carousel' });
    }
    // Limited-time offers…: not rendered by the CRM yet.
  }

  return {
    externalId: template.id ?? null,
    name: template.name,
    language: template.language,
    category: CATEGORY[(template.category ?? '').toUpperCase()] ?? 'utility',
    status,
    statusReason:
      template.rejected_reason && template.rejected_reason !== 'NONE'
        ? template.rejected_reason
        : null,
    components,
    variables,
  };
}

/**
 * The Graph send for a stored template: header/body values in placeholder
 * order (positional ones by number) and one entry per dynamic URL button.
 */
export function buildWhatsAppTemplateSend(
  template: SendableTemplate,
  params: Readonly<Record<string, string>>,
): ResolvedTemplate {
  const valuesOf = (component: TemplateComponentType): TemplateParameter[] =>
    sortKeys(
      template.variables
        .filter((variable) => variable.component === component)
        .map((variable) => variable.key),
    ).map((key) => ({ key, value: params[templateParamKey({ component, key })] ?? '' }));

  return {
    name: template.name,
    language: template.language,
    header: valuesOf('header'),
    body: valuesOf('body'),
    buttons: template.variables
      .filter((variable) => variable.component === 'buttons')
      .map((variable) => ({
        index: Number(variable.key),
        subType: 'url',
        parameters: [
          { key: '1', value: params[templateParamKey(variable)] ?? '' },
        ],
      })),
  };
}

function textVariables(
  component: 'header' | 'body',
  source: WhatsAppGraphTemplateComponent,
): RemoteTemplateVariable[] {
  const example = source.example;
  const positional = component === 'header' ? example?.header_text : example?.body_text?.[0];
  const named =
    component === 'header' ? example?.header_text_named_params : example?.body_text_named_params;

  return placeholderKeys(source.text).map((key) => {
    const index = /^\d+$/.test(key) ? Number(key) - 1 : -1;
    const sample =
      (index >= 0 ? positional?.[index] : undefined) ??
      named?.find((param) => param.param_name === key)?.example ??
      null;
    return { key, component, example: sample };
  });
}

/** Positional keys by number (`{{2}}` after `{{1}}`); named keys keep their order. */
function sortKeys(keys: string[]): string[] {
  const numeric = keys.every((key) => /^\d+$/.test(key));
  return numeric ? [...keys].sort((a, b) => Number(a) - Number(b)) : keys;
}

function isHeaderFormat(
  value: string | undefined,
): value is (typeof TEMPLATE_HEADER_FORMATS)[number] {
  return !!value && (TEMPLATE_HEADER_FORMATS as readonly string[]).includes(value);
}
