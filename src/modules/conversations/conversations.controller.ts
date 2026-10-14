// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'node:os';
import { ApiOkResponse } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  ConversationMessageSchema,
  MAX_UPLOAD_BYTES,
  StagedUploadSchema,
} from '@contracts';

import { RemoveUploadedFileInterceptor } from '@common/interceptors/remove-uploaded-file.interceptor';
import { CLS_COMPANY_ID, CLS_USER_ID } from '../../config/cls.keys';
import { SentimentService } from '../analysis/sentiment/sentiment.service';
import { MessageService } from '../message/message.service';
import { ConversationsService } from './conversations.service';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { StageUploadDto } from './dto/stage-upload.dto';
import { ConversationSentimentDto } from './dto/conversation-sentiment.dto';
import { AssignmentOutcome } from './assignment/assignment.types';
import { ConversationAccessService } from './realtime/conversation-access.service';
import { ConversationUploadsService } from './uploads/conversation-uploads.service';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly service: ConversationsService,
    private readonly messages: MessageService,
    private readonly sentiment: SentimentService,
    private readonly access: ConversationAccessService,
    private readonly uploads: ConversationUploadsService,
    private readonly cls: ClsService,
  ) {}

  /**
   * Stages a file to send in this conversation (multipart `file` + `kind`).
   * The file streams to a temp dir (never buffered), then is checked against
   * the channel's capabilities and kept 24 h until a send references its
   * `uploadId`.
   */
  @Post(':id/uploads')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
    RemoveUploadedFileInterceptor,
  )
  @ZodSerializerDto(StagedUploadSchema)
  async stageUpload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: StageUploadDto,
  ) {
    if (!file) throw new BadRequestException('A file is required');

    const companyId = await this.assertConversationAccess(id);
    return this.uploads.stage(id, companyId, file, body);
  }

  @Get('assignments/:conversationId')
  assignments(@Param('conversationId') conversationId: string) {
    return this.service.getAssigments(conversationId);
  }

  @Post('assign')
  @HttpCode(HttpStatus.ACCEPTED)
  async assign(@Body() { conversationId, memberId }: AssignConversationDto) {
    const outcome = await this.service.assign(conversationId, memberId, {
      companyId: this.cls.get<string>(CLS_COMPANY_ID),
      requesterId: this.cls.get<string>(CLS_USER_ID),
    });

    if (outcome === AssignmentOutcome.CONFLICT) {
      throw new ConflictException(
        'Conversation already assigned to another member',
      );
    }
    if (outcome === AssignmentOutcome.SKIPPED) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      message: 'member assigned',
      outcome,
      conversationId,
      memberId,
    };
  }

  @Get('list')
  list(@Query('agentId') id?: string) {
    return this.service.list(
      id ?? this.cls.get<string>(CLS_USER_ID),
      this.cls.get<string>(CLS_COMPANY_ID),
    );
  }

  /**
   * Cola de conversaciones sin asignar de la empresa: visible para cualquier
   * agente, ordenada por antigüedad (la que más espera primero).
   */
  @Get('unassigned')
  unassigned() {
    return this.service.listUnassigned(this.cls.get<string>(CLS_COMPANY_ID));
  }

  /**
   * Vista "sin respuesta": conversaciones cuyo último mensaje es del cliente y
   * lleva más de `minutes` sin respuesta (default 15, tope 1440).
   */
  @Get('needs-response')
  needsResponse(@Query('minutes') minutes?: string) {
    const parsed = minutes ? Number(minutes) : undefined;
    const safeMinutes =
      parsed && Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, 1440)
        : undefined;

    return this.service.listNeedsResponse(
      this.cls.get<string>(CLS_COMPANY_ID),
      safeMinutes,
    );
  }

  /**
   * Reclamo explícito de una conversación libre. El reclamo implícito al
   * responder ya existe; 409 si pertenece a otro agente.
   */
  @Post(':id/claim')
  @HttpCode(HttpStatus.ACCEPTED)
  async claim(@Param('id') conversationId: string) {
    const userId = this.cls.get<string>(CLS_USER_ID);
    const companyId = this.cls.get<string>(CLS_COMPANY_ID);
    if (!userId || !companyId) {
      throw new BadRequestException('User and company context required');
    }

    const outcome = await this.service.claim(conversationId, userId, companyId);

    if (outcome === AssignmentOutcome.CONFLICT) {
      throw new ConflictException(
        'Conversation already assigned to another agent',
      );
    }
    if (outcome === AssignmentOutcome.SKIPPED) {
      throw new NotFoundException('Conversation not found or not claimable');
    }

    return { message: 'conversation claimed', outcome, conversationId };
  }

  /**
   * Thread history, under the same rules as joining its socket room: the
   * conversation must belong to the active company and the role must reach
   * it (agents: own or queued conversations).
   */
  @Get(':id/messages')
  @ZodSerializerDto(ConversationMessageSchema.array())
  async findMessages(@Param('id') id: string) {
    await this.assertConversationAccess(id);

    return this.messages.getConversationMessages(id);
  }

  /**
   * Customer tone of one conversation, scoped to the caller's company:
   * averages over its completed sentiment analyses (historical threads
   * included). Empty conversations stay neutral; unknown or foreign ids are
   * a 404.
   */
  @Get(':id/sentiment')
  @ZodSerializerDto(ConversationSentimentDto)
  @ApiOkResponse({ type: ConversationSentimentDto })
  findSentiment(@Param('id') id: string) {
    const companyId = this.cls.get<string>(CLS_COMPANY_ID);
    if (!companyId) {
      throw new BadRequestException('Company context required');
    }

    return this.sentiment.getConversationSentiment(id, companyId);
  }

  /**
   * Same rules as joining the conversation's socket room: it belongs to the
   * active company and the role reaches it. Returns that company.
   */
  private async assertConversationAccess(conversationId: string) {
    const companyId = this.cls.get<string>(CLS_COMPANY_ID) ?? null;

    await this.access.assertCanJoinConversation(conversationId, {
      userId: this.cls.get<string>(CLS_USER_ID) ?? null,
      companyId,
      authenticated: true,
    });

    return companyId;
  }
}
