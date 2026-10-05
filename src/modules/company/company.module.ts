import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { Company } from './entities/company.entity';
import { CompanySettings } from './entities/company-settings.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { PipelineStage } from '../customers/entities/pipeline-stage.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Company,
      CompanySettings,
      CompanyMember,
      PipelineStage,
    ]),
  ],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
