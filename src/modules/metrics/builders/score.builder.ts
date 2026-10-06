// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

export class ScoreBuilder<T> {
  private object: Record<string, unknown>;
  private outputs: Partial<T> = {}

  constructor(obj: Record<string, any>) {
    this.object = obj;
  }

  private pickFields<K extends keyof T>(pick: (keyof T[K])[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const curr of pick) {
      const currKey = curr as string;
      result[currKey] = this.object[currKey];
    }
    return result;
  }

  private mapFields<K extends keyof T>(mapping: Record<keyof T[K], string>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [newKey, origKey] of Object.entries(mapping)) {
      result[newKey] = this.object[origKey as string];
    }
    return result;
  }

  owner<K extends keyof T>(key: K, pick: (keyof T[K])[], newKey?: string) {
    type SubObj = T[K] extends object ? T[K] : never;
    const finalKey = newKey ?? key;

    this.outputs[finalKey] = this.pickFields<K>(pick) as SubObj;
    return this;
  }

  metrics<K extends keyof T>(
    key: K,
    pick: (keyof T[K])[] | Record<keyof T[K], string>,
    newKey?: string
  ) {
    type SubObj = T[K] extends object ? T[K] : never;
    const finalKey = newKey ?? key;

    if (Array.isArray(pick))
      this.outputs[finalKey] = this.pickFields<K>(pick) as SubObj;
    else
      this.outputs[finalKey] = this.mapFields<K>(pick) as SubObj;

    return this;
  }

  stat<K extends keyof T>(key: K = 'stat' as K, newKey?: string) {
    const finalKey = newKey ?? key;
    this.outputs[finalKey] = (parseInt(this.object[key as string] as string) || 0) as T[K];
    return this;
  }

  label<K extends keyof T>(key: K = 'label' as K, newKey?: string) {
    const finalKey = newKey ?? key;
    this.outputs[finalKey] = this.object[key as string] as T[K]
    return this;
  }

  build(): T {
    return this.outputs as T;
  }
}