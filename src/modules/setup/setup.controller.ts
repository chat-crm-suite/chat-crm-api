import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { CreateSetupDto } from './dto/create-setup.dto';
import { SetupService } from './setup.service';

/**
 * Endpoints públicos de primer arranque. Deliberadamente sin guardas: son la
 * vía de entrada cuando todavía no existe ningún usuario/empresa. `POST` queda
 * bloqueado por el servicio (409) en cuanto la app está inicializada.
 */
@Controller('setup')
export class SetupController {
  constructor(private readonly service: SetupService) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  run(@Body() dto: CreateSetupDto) {
    return this.service.run(dto);
  }
}
