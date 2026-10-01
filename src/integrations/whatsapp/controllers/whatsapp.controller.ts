import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  CreateWhatsAppConfigDto,
  UpdateWhatsAppConfigDto,
} from '../dto/whatsapp-config.dto';
import { JwtAuthGuard } from '../../../auth/guards/index';
import { CompanyGuard } from '../../../modules/company/company.guard';
import { WhatsAppService } from '../whatsapp.service';
import { WhatsAppExceptionFilter } from '../filters/whatsapp-exception.filter';

@Controller('integration/whatsapp')
@UseGuards(JwtAuthGuard, CompanyGuard)
@UseFilters(new WhatsAppExceptionFilter())
export class WhatsappController {
  constructor(private readonly service: WhatsAppService) {}

  @Get('config')
  getConfig() {
    return this.service.getConfig();
  }

  @Get('config/validate')
  validateConfig() {
    return this.service.getConfig();
  }

  @Post()
  create(@Body() dto: CreateWhatsAppConfigDto) {
    return this.service.createConfig(dto);
  }

  @Patch('config')
  update(@Body() dto: UpdateWhatsAppConfigDto) {
    console.log(dto, 'Config in controller');
    return this.service.updateConfig(dto);
  }
}
