import type { DataSource, EntityManager } from 'typeorm';

/**
 * Manager accepted by every factory to persist the built graph. When omitted
 * the factories only build in-memory objects (`build()` semantics); pass a
 * DataSource or a transaction EntityManager (queryRunner.manager) to create.
 */
export type FactoryManager = DataSource | EntityManager;

export type ManagerTransientParams = {
  manager?: FactoryManager;
};
