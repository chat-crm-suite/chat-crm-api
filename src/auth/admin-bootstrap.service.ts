import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { UsersService } from '../modules/users/users.service';

/**
 * Crea el primer usuario admin si la tabla `users` está vacía.
 *
 * Se activa definiendo BOOTSTRAP_ADMIN_USERNAME y BOOTSTRAP_ADMIN_PASSWORD
 * en el entorno. Es idempotente: si ya existe al menos un usuario, no hace
 * nada aunque las variables sigan definidas. Nunca registra el password.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly users: UsersService,
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const existing = await this.users.find({});
      if (existing) return;

      const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

      if (!username || !password) {
        this.logger.info(
          'users table is empty and BOOTSTRAP_ADMIN_* is not set - skipping admin bootstrap',
        );
        return;
      }

      if (password.length < 8) {
        this.logger.error(
          'BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters - skipping admin bootstrap',
        );
        return;
      }

      const user = await this.users.create({ username, password });
      await this.users.update(user.id, { role: 'admin' });
      this.logger.info({ username }, 'bootstrap: first admin user created');
    } catch (err: unknown) {
      this.logger.error({ err }, 'bootstrap: admin user creation failed');
    }
  }
}
