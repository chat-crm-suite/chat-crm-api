import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { MembersModule } from '../modules/member/member.module';
import { AuthController } from './auth.controller';
import { UsersModule } from '@modules';
import { SetupModule } from '../modules/setup/setup.module';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { AdminBootstrapService } from './admin-bootstrap.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your_jwt_secret',
      signOptions: { expiresIn: '1d' },
    }),
    MembersModule,
    SetupModule,
  ],
  providers: [AuthService, JwtStrategy, AdminBootstrapService],
  controllers: [AuthController],
})
export class AuthModule {}
