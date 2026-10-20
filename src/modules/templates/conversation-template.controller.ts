// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Body, Controller, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import type { TenantContext } from '../../auth/auth.types';
import { CLS_USER_ID } from '../../config/cls.keys';
import { SendTemplateResultSchema } from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { ConversationsService } from '../conversations/conversations.service';
import { AgentMessageSender } from '../conversations/outbound/agent-message-sender.service';
import { ConversationAccessService } from '../conversations/realtime/conversation-access.service';
import { SendTemplateDto } from './dto/send-template.dto';
import { TemplatesService } from './templates.service';

/**
 * `POST /conversations/:id/template`: the only way to write outside the
 * reply window. Same access as the thread; the message itself reaches the
 * thread through `conversation:message:broadcast` like any outbound message.
 */
@ApiTags('Templates')
@ApiCookieAuth('access_token')
@Controller('conversations')
export class ConversationTemplateController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly conversations: ConversationsService,
    private readonly access: ConversationAccessService,
    private readonly sender: AgentMessageSender,
    private readonly cls: ClsService,
  ) {}

  @Post(':id/template')
  @ApiOperation({ summary: 'Send an approved template in the conversation' })
  @ZodSerializerDto(SendTemplateResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(SendTemplateResultSchema) })
  async send(
    @Param('id') id: string,
    @Body() body: SendTemplateDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    await this.access.assertCanJoinConversation(id, {
      userId: this.cls.get<string>(CLS_USER_ID) ?? null,
      companyId: tenant.companyId,
      authenticated: true,
    });

    const conversation = await this.conversations.findReplyWindow(id);
    if (!conversation) throw new NotFoundException('Conversation not found');

    const prepared = await this.templates.prepareSend(tenant, conversation, body);
    const message = await this.sender.sendTemplate({
      conversationId: id,
      companyId: tenant.companyId,
      senderMemberId: tenant.memberId,
      clientMessageId: body.clientMessageId ?? null,
      ...prepared,
    });

    return { messageId: message.id, conversationId: id };
  }
}
