// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CsvModule } from 'nest-csv-parser';

import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { Customer } from './entities/customer.entity';
import { CustomerIdentity } from './entities/customer-identity.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, CustomerIdentity]), CsvModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
