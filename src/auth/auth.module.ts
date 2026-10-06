import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { CompanyMembersModule } from '../modules/company-members/company-members.module';
import { AuthController } from './auth.controller';
import { UsersModule } from '@modules';
import { SetupModule } from '../modules/setup/setup.module';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { getJwtSecret } from './jwt.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '1d' },
    }),
    CompanyMembersModule,
    SetupModule,
  ],
  providers: [AuthService, JwtStrategy, AdminBootstrapService],
  controllers: [AuthController],
})
export class AuthModule {}
