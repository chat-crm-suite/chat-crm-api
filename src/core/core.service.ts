// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Repository, FindOptionsWhere, UpdateResult } from 'typeorm';
import { Core, DTO, Entity } from './core.interface';

export abstract class CoreService<T extends Entity> implements Core<T> {
  protected constructor(protected readonly repository: Repository<T>) { }
  // TODO: Refactor using dto logic
  create(_dto: DTO): Promise<T> {
    throw new Error('Method not implemented.');
  }
  update(_id: string, _dto: DTO): Promise<UpdateResult> {
    throw new Error('Method not implemented.');
  }

  async all(): Promise<T[]> {
    return await this.repository.find();
  }

  async find(where: FindOptionsWhere<T>): Promise<T | null> {
    return await this.repository.findOneBy(where);
  }
}