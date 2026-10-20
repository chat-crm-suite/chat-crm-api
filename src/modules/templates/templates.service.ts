// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, Repository } from 'typeorm';

import {
  channelCapabilities,
  ConversationErrorCode,
  renderTemplateText,
  templateParamKey,
  type ChannelType,
  type MemberRole,
  type SendTemplateInput,
  type SyncTemplatesResult,
  type Template,
  type TemplateGroup,
  type TemplateListQuery,
  type TemplateStatus,
  type UpdateTemplateSettingsInput,
} from '../../contracts/index';
import { Channel } from '../channels/entities/channel.entity';
import { MessageTemplate } from '../channels/entities/message-template.entity';
import type { ResolvedTemplate } from '../channels/ports/channel-adapter.port';
import type { TemplateProvider } from '../channels/ports/channel-template.port';
import { ChannelTemplateRegistry } from '../channels/ports/channel-template.registry';

/** Who is asking: agents only ever see approved templates flagged for them. */
export interface TemplateViewer {
  companyId: string;
  role: MemberRole;
}

/** A template validated for one conversation, ready for the sender. */
export interface PreparedTemplateSend {
  templateId: string;
  /** Rendered header/body/footer text: what the thread shows. */
  body: string;
  template: ResolvedTemplate;
}

const isAgent = (role: MemberRole) => role === 'agent';

/**
 * Provider templates per channel (WhatsApp HSM today), channel-agnostic: the
 * provider is reached only through the `TemplateProvider` port.
 *
 * - list/groups: admin/supervisor see every template; agents only approved
 *   ones with `visibleToAgents`.
 * - sync (admin): upsert by `(channel, name, language)`; templates gone from
 *   the provider become `disabled`.
 * - settings (admin): CRM-only fields (visibility, variable labels).
 * - send: validation + rendering; the sender owns persistence and delivery.
 */
@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templates: Repository<MessageTemplate>,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    private readonly registry: ChannelTemplateRegistry,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TemplatesService.name);
  }

  async list(viewer: TemplateViewer, query: TemplateListQuery = {}): Promise<Template[]> {
    const qb = this.templates
      .createQueryBuilder('template')
      .innerJoinAndSelect('template.channel', 'channel')
      .where('template.company_id = :companyId', { companyId: viewer.companyId });

    if (query.channelId) {
      qb.andWhere('template.channel_id = :channelId', { channelId: query.channelId });
    }
    if (isAgent(viewer.role)) {
      qb.andWhere('template.status = :approved', { approved: 'approved' }).andWhere(
        'template.visible_to_agents = :visible',
        { visible: true },
      );
    } else if (query.status) {
      qb.andWhere('template.status = :status', { status: query.status });
    }
    if (query.q) {
      qb.andWhere('LOWER(template.name) LIKE :q', { q: `%${query.q.toLowerCase()}%` });
    }

    const rows = await qb
      .orderBy('template.name', 'ASC')
      .addOrderBy('template.language', 'ASC')
      .addOrderBy('channel.name', 'ASC')
      .getMany();

    return rows.map(toTemplate);
  }

  /** The same template name across channels (the "Plantillas" table). */
  async groups(viewer: TemplateViewer, query: TemplateListQuery = {}): Promise<TemplateGroup[]> {
    const groups = new Map<string, Template[]>();
    for (const template of await this.list(viewer, query)) {
      const group = groups.get(template.name) ?? [];
      group.push(template);
      groups.set(template.name, group);
    }

    return [...groups].map(([name, templates]) => ({
      name,
      category: templates[0].category,
      multiChannel: new Set(templates.map((template) => template.channelId)).size > 1,
      templates: templates.map((template) => ({
        id: template.id,
        channelId: template.channelId,
        channelType: template.channelType,
        channelName: template.channelName,
        language: template.language,
        status: template.status,
        visibleToAgents: template.visibleToAgents,
        syncedAt: template.syncedAt,
      })),
    }));
  }

  /** Pull the channel's templates from its provider and upsert them. */
  async sync(companyId: string, channelId: string): Promise<SyncTemplatesResult> {
    const channel = await this.channels.findOne({ where: { id: channelId, companyId } });
    if (!channel) throw new NotFoundException('Channel not found');

    const provider = this.providerFor(channel.type);
    const outcome = await provider.listRemote(channel.id);
    if (!outcome.ok) {
      throw new BadGatewayException({
        code: 'provider_error',
        message: outcome.error.message,
      });
    }

    const syncedAt = new Date();
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MessageTemplate);
      const existing = await repo.find({ where: { channelId: channel.id } });
      const byKey = new Map(existing.map((row) => [templateKey(row), row]));
      const seen = new Set<string>();
      const statusChanges: SyncTemplatesResult['statusChanges'] = [];
      const toSave: MessageTemplate[] = [];
      let created = 0;
      let updated = 0;
      let disabled = 0;

      for (const remote of outcome.templates) {
        const key = templateKey(remote);
        if (seen.has(key)) continue;
        seen.add(key);

        const current = byKey.get(key);
        const from: TemplateStatus | null = current?.status ?? null;
        const row =
          current ??
          repo.create({
            companyId,
            channelId: channel.id,
            name: remote.name,
            language: remote.language,
            visibleToAgents: true,
          });
        if (current) updated++;
        else created++;

        Object.assign(row, {
          category: remote.category,
          status: remote.status,
          statusReason: remote.statusReason,
          components: remote.components,
          variables: remote.variables,
          externalId: remote.externalId,
          syncedAt,
        });
        toSave.push(row);
        if (from !== remote.status) {
          statusChanges.push({ templateId: '', name: row.name, language: row.language, from, to: remote.status });
        }
      }

      for (const row of existing) {
        if (seen.has(templateKey(row)) || row.status === 'disabled') continue;
        statusChanges.push({
          templateId: row.id,
          name: row.name,
          language: row.language,
          from: row.status,
          to: 'disabled',
        });
        row.status = 'disabled';
        toSave.push(row);
        disabled++;
      }

      const saved = await repo.save(toSave);
      // New rows only get their id on save: fill the change entries now.
      const idByKey = new Map(saved.map((row) => [templateKey(row), row.id]));
      for (const change of statusChanges) {
        change.templateId ||= idByKey.get(templateKey(change)) ?? '';
      }

      this.logger.info(
        { channelId: channel.id, total: outcome.templates.length, created, updated, disabled },
        'Templates synced',
      );

      return {
        channelId: channel.id,
        total: seen.size,
        created,
        updated,
        disabled,
        statusChanges,
        syncedAt,
      };
    });
  }

  /** CRM-side settings: visibility for agents and variable labels. */
  async updateSettings(
    companyId: string,
    id: string,
    input: UpdateTemplateSettingsInput,
  ): Promise<Template> {
    const row = await this.templates.findOne({
      where: { id, companyId },
      relations: { channel: true },
    });
    if (!row) throw new NotFoundException('Template not found');

    if (input.visibleToAgents !== undefined) row.visibleToAgents = input.visibleToAgents;
    if (input.variableLabels) {
      const labels = { ...(row.variableLabels ?? {}) };
      for (const [key, label] of Object.entries(input.variableLabels)) {
        if (label) labels[key] = label;
        else delete labels[key];
      }
      row.variableLabels = labels;
    }

    await this.templates.save(row);
    return toTemplate(row);
  }

  /**
   * Validates a template send for a conversation of `channelId` and renders
   * it: the channel supports templates, the template belongs to it and is
   * approved (and visible, for agents), and every variable has a value.
   */
  async prepareSend(
    viewer: TemplateViewer,
    conversation: { channelId: string; channelType: ChannelType },
    input: SendTemplateInput,
  ): Promise<PreparedTemplateSend> {
    const provider = this.providerFor(conversation.channelType);

    const row = await this.templates.findOne({
      where: { id: input.templateId, companyId: viewer.companyId },
    });
    if (
      !row ||
      row.channelId !== conversation.channelId ||
      row.status !== 'approved' ||
      (isAgent(viewer.role) && !row.visibleToAgents)
    ) {
      throw new ConflictException({
        code: ConversationErrorCode.TemplateUnavailable,
        message: 'Template not available for this conversation',
      });
    }

    const params = input.params ?? {};
    const variables = row.variables ?? [];
    const missing = variables
      .map((variable) => templateParamKey(variable))
      .filter((key) => !params[key]?.trim());
    if (missing.length) {
      throw new BadRequestException({
        code: ConversationErrorCode.TemplateParamsMissing,
        message: `Missing template values: ${missing.join(', ')}`,
        missing,
      });
    }

    return {
      templateId: row.id,
      body: renderBody(row, params),
      template: provider.buildSend(
        {
          name: row.name,
          language: row.language,
          components: row.components ?? [],
          variables,
        },
        params,
      ),
    };
  }

  /** The channel type's provider, or 409 `templates_unsupported`. */
  private providerFor(type: ChannelType): TemplateProvider {
    const provider = channelCapabilities(type)?.supportsTemplates
      ? this.registry.for(type)
      : null;
    if (!provider) {
      throw new ConflictException({
        code: ConversationErrorCode.TemplatesUnsupported,
        message: `The ${type} channel has no template support`,
      });
    }
    return provider;
  }
}

function templateKey(template: { name: string; language: string }): string {
  return `${template.name}\u0000${template.language}`;
}

/** Header (text), body and footer with the values filled, one per paragraph. */
function renderBody(row: MessageTemplate, params: Readonly<Record<string, string>>): string {
  return (row.components ?? [])
    .filter(
      (component) =>
        component.text &&
        (component.type === 'body' ||
          component.type === 'footer' ||
          (component.type === 'header' && (component.format ?? 'text') === 'text')),
    )
    .map((component) => renderTemplateText(component.text ?? '', component.type, params))
    .join('\n\n');
}

export function toTemplate(row: MessageTemplate): Template {
  const labels = row.variableLabels ?? {};
  return {
    id: row.id,
    channelId: row.channelId,
    channelType: row.channel.type,
    channelName: row.channel.name,
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    statusReason: row.statusReason ?? null,
    components: row.components ?? [],
    variables: (row.variables ?? []).map((variable) => ({
      key: variable.key,
      component: variable.component,
      label: labels[templateParamKey(variable)] || null,
      example: variable.example ?? null,
    })),
    visibleToAgents: row.visibleToAgents,
    externalId: row.externalId ?? null,
    syncedAt: row.syncedAt ?? null,
    updatedAt: row.updatedAt,
  };
}
