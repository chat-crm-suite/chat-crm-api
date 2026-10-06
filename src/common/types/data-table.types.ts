// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

export type SortItem = {
  id: string;
  desc: boolean;
};

export interface DataTableBaseQuery {
  page: number;
  perPage: number;
  sort: SortItem[];
}

export type TypeOrmQueryHelperInput = DataTableBaseQuery & Record<string, unknown>;