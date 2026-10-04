import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { UsersService } from '../modules/users/users.service';
import { SetupService } from '../modules/setup/setup.service';
import type { CreateSetupDto } from '../modules/setup/dto/create-setup.dto';
import { WhatsAppApiVersionSchema } from '../contracts/index';

/**
 * Bootstrap de arranque sin UI (despliegues headless).
 *
 * 1. Crea el primer usuario admin si la tabla `users` está vacía
 *    (BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD).
 * 2. Si además hay BOOTSTRAP_COMPANY_NAME y la app no está inicializada,
 *    crea empresa + member admin (+ config de WhatsApp si las WHATSAPP_*
 *    están completas) reutilizando la lógica del SetupService.
 *
 * Idempotente: si ya está inicializado no hace nada. Nunca registra el
 * password. Se mantiene el comportamiento original cuando no se definen las
 * variables nuevas.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly users: UsersService,
    private readonly setup: SetupService,
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

      const existing = await this.users.find({});
      if (!existing) {
        if (!username || !password) {
          this.logger.info(
            'users table is empty and BOOTSTRAP_ADMIN_* is not set - skipping admin bootstrap',
          );
        } else if (password.length < 8) {
          this.logger.error(
            'BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters - skipping admin bootstrap',
          );
        } else {
          const user = await this.users.create({ username, password });
          await this.users.update(user.id, { role: 'admin' });
          this.logger.info({ username }, 'bootstrap: first admin user created');
        }
      }

      await this.provisionCompany(username, password);
    } catch (err: unknown) {
      this.logger.error({ err }, 'bootstrap: admin user creation failed');
    }
  }

  private async provisionCompany(
    username?: string,
    password?: string,
  ): Promise<void> {
    const companyName = process.env.BOOTSTRAP_COMPANY_NAME;
    if (!companyName) return;

    if (!username || !password) {
      this.logger.error(
        'BOOTSTRAP_COMPANY_NAME requires BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD - skipping company bootstrap',
      );
      return;
    }

    const { initialized } = await this.setup.status();
    if (initialized) {
      this.logger.info('setup already initialized - skipping company bootstrap');
      return;
    }

    const dto: CreateSetupDto = {
      admin: { username, password },
      company: { name: companyName },
      whatsapp: this.whatsappFromEnv(),
    };

    await this.setup.provision(dto);
    this.logger.info({ company: companyName }, 'bootstrap: first company created');
  }

  private whatsappFromEnv(): CreateSetupDto['whatsapp'] {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;

    if (!phoneNumberId || !accessToken || !webhookUrl) return undefined;

    return {
      businessId: process.env.WHATSAPP_BUSINESS_ID,
      accessToken,
      phoneNumberId,
      webhookUrl,
      // Invalid/unknown versions are dropped so the entity default applies.
      apiVersion: WhatsAppApiVersionSchema.safeParse(
        process.env.WHATSAPP_API_VERSION,
      ).data,
    };
  }
}
