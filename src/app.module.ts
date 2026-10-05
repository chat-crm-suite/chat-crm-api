import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

// Configurations
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AppConfigsModule } from './config/index';

// Controllers & Services
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Modules
import { AuthModule } from './auth/auth.module';
import { CoreModules } from '@modules';
import { IntegrationsModules } from './integrations/index';
import { ServeStaticModule } from '@nestjs/serve-static';

import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigsModule,
    AuthModule,
    CoreModules,
    IntegrationsModules,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
  ],
  controllers: [AppController],
  providers: [AppService,
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ZodSerializerInterceptor
    }
  ],
})

export class AppModule { }
