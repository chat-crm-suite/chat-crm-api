import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { Company } from './entities/company.entity';
import { Member } from '../member/member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Company, Member])],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule { }
