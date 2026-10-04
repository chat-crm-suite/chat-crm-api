import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatsService } from '../chats.service';
import { ChatDto, UpdateChatDto } from '../dto/chat.dto';
import { MessageService } from '../../message/message.services';
import { ChatAssignExceptionFilter } from '../filters/chat-assign.filter';
import { ChatAssignDto } from '../dto/chat-assign.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '../../../config/multer.config';
import { ClsService } from 'nestjs-cls';
import { CLS_COMPANY_ID, CLS_USER_ID } from '../../../config/cls.keys';
import { AssignmentOutcome } from '../assignment/assignment.types';

@Controller('chats')
@UseGuards(AuthGuard('jwt'))
export class ChatsController {
  constructor(
    private readonly service: ChatsService,
    private readonly messages: MessageService,
    private readonly cls: ClsService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', multerConfig))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    console.log(file);
    return {
      message: 'Archivo recibido',
      filename: file.filename,
      size: file.size,
      pathFile: `/uploads/${file.filename}`,
    };
  }

  @Post()
  create(@Body() dto: ChatDto) {
    return this.service.create(dto);
  }

  @Get('assignments/:chatId')
  assignments(@Param('chatId') id: string) {
    return this.service.getAssigments(id);
  }

  @UseFilters(ChatAssignExceptionFilter)
  @Post('assign')
  @HttpCode(HttpStatus.ACCEPTED)
  async assign(@Body() { chatId, agentId }: ChatAssignDto) {
    const outcome = await this.service.assign(chatId, agentId, {
      companyId: this.cls.get<string>(CLS_COMPANY_ID),
      requesterId: this.cls.get<string>(CLS_USER_ID),
    });

    return {
      message: 'agent assigned',
      outcome,
      chatId,
      agentId,
    };
  }

  @Get('list')
  list(@Query('agentId') id?: string) {
    return this.service.list(id);
  }

  /**
   * Cola de chats sin asignar de la empresa (Q6/Q14): visible para cualquier
   * agente, ordenada por antigüedad (el que más espera primero).
   */
  @Get('unassigned')
  unassigned() {
    return this.service.listUnassigned(this.cls.get<string>(CLS_COMPANY_ID));
  }

  /**
   * Vista "sin respuesta" (Q10): chats cuyo último mensaje es del cliente y
   * lleva más de `minutes` sin respuesta (default 15, tope 1440). Solo lectura.
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
   * Reclamo explícito de un chat libre (Q13). El reclamo implícito al
   * responder ya existe; 409 si el chat pertenece a otro agente (Q9).
   */
  @Post(':id/claim')
  @HttpCode(HttpStatus.ACCEPTED)
  async claim(@Param('id') chatId: string) {
    const agentId = this.cls.get<string>(CLS_USER_ID);
    const companyId = this.cls.get<string>(CLS_COMPANY_ID);
    if (!agentId || !companyId) {
      throw new BadRequestException('User and company context required');
    }

    const outcome = await this.service.claim(chatId, agentId, companyId);

    if (outcome === AssignmentOutcome.CONFLICT) {
      throw new ConflictException('Chat already assigned to another agent');
    }
    if (outcome === AssignmentOutcome.SKIPPED) {
      throw new NotFoundException('Chat not found or not claimable');
    }

    return { message: 'chat claimed', outcome, chatId };
  }

  @Get(':id/messages')
  findMessages(@Param('id') id: string) {
    return this.messages.getChatMessages(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateChatDto: UpdateChatDto) {
    return this.service.update(+id, updateChatDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(+id);
  }
}
