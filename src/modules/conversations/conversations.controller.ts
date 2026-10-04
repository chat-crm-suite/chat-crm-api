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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClsService } from 'nestjs-cls';

import { multerConfig } from '../../config/multer.config';
import { CLS_COMPANY_ID, CLS_USER_ID } from '../../config/cls.keys';
import { MessageService } from '../message/message.service';
import { ConversationsService } from './conversations.service';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { AssignmentOutcome } from './assignment/assignment.types';

@Controller('conversations')
@UseGuards(AuthGuard('jwt'))
export class ConversationsController {
  constructor(
    private readonly service: ConversationsService,
    private readonly messages: MessageService,
    private readonly cls: ClsService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', multerConfig))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return {
      message: 'Archivo recibido',
      filename: file.filename,
      size: file.size,
      pathFile: `/uploads/${file.filename}`,
    };
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

  @Get(':id/messages')
  findMessages(@Param('id') id: string) {
    return this.messages.getConversationMessages(id);
  }
}
