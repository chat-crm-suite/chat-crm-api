// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { TemplateComponentSchema } from '@contracts';
import {
  buildWhatsAppTemplateSend,
  normalizeWhatsAppTemplate,
  placeholderKeys,
} from './whatsapp-template.mapper';

/** Graph `message_templates` items -> neutral templates, and back to a send. */
describe('WhatsApp template mapper', () => {
  const graphTemplate = {
    id: '1234',
    name: 'order_update',
    language: 'es',
    status: 'APPROVED',
    category: 'UTILITY',
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'Hola {{1}}',
        example: { header_text: ['Ana'] },
      },
      {
        type: 'BODY',
        text: 'Tu pedido {{2}} llega el {{1}}. Pedido {{2}}.',
        example: { body_text: [['lunes', '#123']] },
      },
      { type: 'FOOTER', text: 'Gracias' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Ok' },
          { type: 'URL', text: 'Ver', url: 'https://x.test/{{1}}', example: ['https://x.test/abc'] },
          { type: 'FLOW', text: 'Abrir' },
        ],
      },
    ],
  };

  it('normalizes components, statuses and variables with their samples', () => {
    const template = normalizeWhatsAppTemplate(graphTemplate);

    expect(template).toMatchObject({
      externalId: '1234',
      name: 'order_update',
      language: 'es',
      category: 'utility',
      status: 'approved',
      statusReason: null,
    });
    expect(template.components.map((component) => TemplateComponentSchema.parse(component))).toEqual([
      { type: 'header', format: 'text', text: 'Hola {{1}}' },
      { type: 'body', text: 'Tu pedido {{2}} llega el {{1}}. Pedido {{2}}.' },
      { type: 'footer', text: 'Gracias' },
      {
        type: 'buttons',
        buttons: [
          { type: 'quick_reply', text: 'Ok', url: null, phoneNumber: null },
          { type: 'url', text: 'Ver', url: 'https://x.test/{{1}}', phoneNumber: null },
          { type: 'other', text: 'Abrir', url: null, phoneNumber: null },
        ],
      },
    ]);
    expect(template.variables).toEqual([
      { key: '1', component: 'header', example: 'Ana' },
      { key: '2', component: 'body', example: '#123' },
      { key: '1', component: 'body', example: 'lunes' },
      { key: '1', component: 'buttons', example: 'https://x.test/abc' },
    ]);
  });

  it('maps named parameters, rejection reasons and unknown statuses', () => {
    const template = normalizeWhatsAppTemplate({
      name: 'named',
      language: 'en',
      status: 'REJECTED',
      category: 'MARKETING',
      rejected_reason: 'INVALID_FORMAT',
      parameter_format: 'NAMED',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{first_name}}',
          example: { body_text_named_params: [{ param_name: 'first_name', example: 'Ana' }] },
        },
      ],
    });

    expect(template).toMatchObject({
      status: 'rejected',
      category: 'marketing',
      statusReason: 'INVALID_FORMAT',
      variables: [{ key: 'first_name', component: 'body', example: 'Ana' }],
    });
    expect(normalizeWhatsAppTemplate({ name: 'x', language: 'es', status: 'WHATEVER' }).status).toBe(
      'pending',
    );
    expect(normalizeWhatsAppTemplate({ name: 'x', language: 'es', status: 'PAUSED' }).status).toBe('paused');
  });

  it('builds the send with positional values in numeric order and URL buttons by index', () => {
    const template = normalizeWhatsAppTemplate(graphTemplate);

    expect(
      buildWhatsAppTemplateSend(template, {
        'header:1': 'Ana',
        'body:1': 'martes',
        'body:2': '#987',
        'buttons:1': 'xyz',
      }),
    ).toEqual({
      name: 'order_update',
      language: 'es',
      header: [{ key: '1', value: 'Ana' }],
      body: [
        { key: '1', value: 'martes' },
        { key: '2', value: '#987' },
      ],
      buttons: [{ index: 1, subType: 'url', parameters: [{ key: '1', value: 'xyz' }] }],
    });
  });

  it('lists placeholder keys once, in order of appearance', () => {
    expect(placeholderKeys('{{2}} y {{ 1 }} y {{2}}')).toEqual(['2', '1']);
    expect(placeholderKeys(null)).toEqual([]);
  });
});
