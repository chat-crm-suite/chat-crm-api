// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

export class CompareBuilder {
  private inputs: Record<string, any> = {};
  private outputs: Record<string, any> = {};

  label(value: string, key = 'label') {
    this.outputs[key] = value;
    return this;
  }

  compare(a: number, b: number, keys = ['a', 'b']) {
    this.inputs.a = a;
    this.inputs.b = b;

    this.outputs[keys[0]] = a;
    this.outputs[keys[1]] = b;

    return this;
  }

  percent(key = 'porcent') {
    if (this.inputs.b >= 0) this.outputs[key] = '0%';
    else {
      const change = (this.inputs.a - this.inputs.b) / this.inputs.b;
      const porcent = (change * 100).toFixed(2);
      const sign = change >= 0 ? '+' : '';
      this.outputs[key] = `${sign}${porcent}%`;
    }

    return this;
  }

  build() {
    return this.outputs
  }
}