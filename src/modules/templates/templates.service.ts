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
  renderTemplateCardText,
  renderTemplateText,
  templateCardMedia,
  templateCards,
  templateCardVariableKey,
  templateHeaderMedia,
  templateParamKey,
  templateSendSupport,
  type ChannelType,
  type MemberRole,
  type SendTemplateInput,
  type StagedUpload,
  type SyncTemplatesResult,
  type Template,
  type TemplateButton,
  type TemplateGroup,
  type TemplateHeaderMedia,
  type TemplateListQuery,
  type TemplateStatus,
  type UpdateTemplateSettingsInput,
} from '../../contracts/index';
import { Channel } from '../channels/entities/channel.entity';
import { MessageTemplate } from '../channels/entities/message-template.entity';
import type { ResolvedTemplate } from '../channels/ports/channel-adapter.port';
import type { TemplateProvider } from '../channels/ports/channel-template.port';
import { ChannelTemplateRegistry } from '../channels/ports/channel-template.registry';
import {
  ConversationUploadsService,
  type IncomingUpload,
} from '../conversations/uploads/conversation-uploads.service';
import {
  StagedUploadStore,
  templateUploadScope,
} from '../media/staging/staged-upload.store';
import type { TemplateSnapshot } from '../message/entities/message.entity';

/** Who is asking: agents only ever see approved templates flagged for them. */
export interface TemplateViewer {
  companyId: string;
  role: MemberRole;
}

/** A template validated for one conversation, ready for the sender. */
export interface PreparedTemplateSend {
  templateId: string;
  /** Rendered header/body/footer text (search, chat list preview). */
  body: string;
  /** The template as the customer sees it, stored on the message. */
  snapshot: TemplateSnapshot;
  template: ResolvedTemplate;
  /** The staged header file, checked to exist; the sender consumes it. */
  headerMedia?: StagedTemplateFile;
  /** Carousel: each card's staged header file (null = none), by card. */
  cardMedia?: Array<StagedTemplateFile | null>;
}

/** A header file staged for a template, checked to exist and match. */
export interface StagedTemplateFile {
  uploadId: string;
  kind: TemplateHeaderMedia;
  filename: string;
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
    private readonly uploads: ConversationUploadsService,
    private readonly staged: StagedUploadStore,
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
    if (!row || row.channelId !== conversation.channelId || !isSendableBy(row, viewer)) {
      throw new ConflictException({
        code: ConversationErrorCode.TemplateUnavailable,
        message: 'Template not available for this conversation',
      });
    }
    const components = row.components ?? [];
    assertSendSupported(components, conversation.channelType);

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

    const headerMedia = await this.checkStaged(
      row,
      viewer.companyId,
      templateHeaderMedia(components),
      input.headerMedia?.uploadId,
      'The template header',
    );
    const cardMedia = await this.checkCardMedia(row, viewer.companyId, input);

    return {
      templateId: row.id,
      body: renderBody(row, params),
      snapshot: toSnapshot(row, params, headerMedia?.filename ?? null, cardMedia),
      template: provider.buildSend(
        {
          name: row.name,
          language: row.language,
          components,
          variables,
        },
        params,
      ),
      ...(headerMedia ? { headerMedia } : {}),
      ...(cardMedia.some(Boolean) ? { cardMedia } : {}),
    };
  }

  /**
   * Stages the header file of a template (`POST /templates/:id/header-upload`)
   * with the channel's upload rules, scoped to the template so it can be sent
   * in any conversation of its channel, or one being started.
   */
  async stageHeaderMedia(
    viewer: TemplateViewer,
    templateId: string,
    upload: IncomingUpload,
    card?: number,
  ): Promise<StagedUpload> {
    const row = await this.templates.findOne({
      where: { id: templateId, companyId: viewer.companyId },
      relations: { channel: true },
    });
    if (!row || !isSendableBy(row, viewer)) {
      throw new ConflictException({
        code: ConversationErrorCode.TemplateUnavailable,
        message: 'Template not available',
      });
    }
    const components = row.components ?? [];
    assertSendSupported(components, row.channel.type);

    // `card` targets a carousel card's header; none = the template header.
    const kind =
      card === undefined ? templateHeaderMedia(components) : templateCardMedia(components)[card];
    if (!kind) {
      throw new ConflictException({
        code: ConversationErrorCode.TemplateHeaderMediaNotNeeded,
        message:
          card === undefined
            ? 'The template header takes no file'
            : `Card ${card + 1} of the template takes no file`,
      });
    }

    return this.uploads.stageFor(
      {
        companyId: viewer.companyId,
        scope: templateUploadScope(row.id),
        channelType: row.channel.type,
      },
      upload,
      { kind },
    );
  }

  /**
   * A header file a send references (the template header or one card):
   * required when the header takes one, refused when it does not, and it
   * must still be staged for this template with the right kind (an expired
   * upload is a mismatch too).
   */
  private async checkStaged(
    row: MessageTemplate,
    companyId: string,
    kind: TemplateHeaderMedia | null,
    uploadId: string | undefined,
    what: string,
  ): Promise<StagedTemplateFile | null> {
    if (kind && !uploadId) {
      throw new BadRequestException({
        code: ConversationErrorCode.TemplateHeaderMediaMissing,
        message: `${what} needs a ${kind} file`,
      });
    }
    if (!uploadId) return null;

    const staged = kind
      ? await this.staged.find(uploadId, {
          companyId,
          scope: templateUploadScope(row.id),
          kind,
        })
      : null;
    if (!kind || !staged) {
      throw new BadRequestException({
        code: ConversationErrorCode.TemplateHeaderMediaMismatch,
        message: kind
          ? `${what} file is not a staged ${kind} for this template`
          : `${what} takes no file`,
      });
    }
    return { uploadId, kind, filename: staged.filename };
  }

  /** Each carousel card's header file, in card order. */
  private async checkCardMedia(
    row: MessageTemplate,
    companyId: string,
    input: SendTemplateInput,
  ): Promise<Array<StagedTemplateFile | null>> {
    const kinds = templateCardMedia(row.components ?? []);
    if ((input.cards?.length ?? 0) > kinds.length) {
      throw new BadRequestException({
        code: ConversationErrorCode.TemplateHeaderMediaMismatch,
        message: `The template has ${kinds.length} cards`,
      });
    }
    const files: Array<StagedTemplateFile | null> = [];
    for (const [index, kind] of kinds.entries()) {
      files.push(
        await this.checkStaged(
          row,
          companyId,
          kind,
          input.cards?.[index]?.headerMedia?.uploadId,
          `Card ${index + 1}`,
        ),
      );
    }
    return files;
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

/** Approved, and visible to agents when the viewer is one. */
function isSendableBy(row: MessageTemplate, viewer: TemplateViewer): boolean {
  return row.status === 'approved' && (!isAgent(viewer.role) || row.visibleToAgents);
}

/** 409 `template_unsendable` for what the CRM cannot send on this channel. */
function assertSendSupported(
  components: MessageTemplate['components'],
  channelType: ChannelType,
): void {
  const support = templateSendSupport(components, channelType);
  if (!support.ok) {
    throw new ConflictException({
      code: ConversationErrorCode.TemplateUnsendable,
      message: `The template cannot be sent from the CRM (${support.reason})`,
      reason: support.reason,
    });
  }
}

/**
 * The template as sent, values filled. A dynamic URL button gets its suffix
 * (`buttons:<index>`) in place of the `{{1}}` of its URL.
 */
function toSnapshot(
  row: MessageTemplate,
  params: Readonly<Record<string, string>>,
  headerFilename: string | null,
  cardMedia: Array<StagedTemplateFile | null> = [],
): TemplateSnapshot {
  const components = row.components ?? [];
  const find = (type: string) => components.find((component) => component.type === type);
  const header = find('header');
  const mediaType = templateHeaderMedia(components);
  const cards = templateCards(components);

  return {
    name: row.name,
    language: row.language,
    header: mediaType
      ? { kind: 'media', mediaType, filename: headerFilename }
      : header?.text
        ? { kind: 'text', text: renderTemplateText(header.text, 'header', params) }
        : null,
    body: renderTemplateText(find('body')?.text ?? '', 'body', params),
    footer: find('footer')?.text ?? null,
    buttons: withUrlSuffixes(find('buttons')?.buttons ?? [], (index) =>
      templateParamKey({ component: 'buttons', key: String(index) }),
    ),
    ...(cards.length
      ? {
          cards: cards.map((card, index) => {
            const file = cardMedia[index];
            return {
              header: file ? { kind: 'media', mediaType: file.kind, filename: file.filename } : null,
              body: renderTemplateCardText(card.body ?? '', index, params),
              buttons: withUrlSuffixes(card.buttons, (button) =>
                templateParamKey({
                  component: 'carousel',
                  key: templateCardVariableKey(index, 'button', button),
                }),
              ),
            };
          }),
        }
      : {}),
  };

  /** A dynamic URL button gets its value in place of the `{{1}}` of its URL. */
  function withUrlSuffixes(
    buttons: readonly TemplateButton[],
    paramKey: (index: number) => string,
  ): TemplateButton[] {
    return buttons.map((button, index) => ({
      ...button,
      url: button.url?.replace(/\{\{\s*1\s*\}\}/, params[paramKey(index)] ?? ''),
    }));
  }
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
    headerMedia: templateHeaderMedia(row.components ?? []),
    sendSupport: templateSendSupport(row.components ?? [], row.channel.type),
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
