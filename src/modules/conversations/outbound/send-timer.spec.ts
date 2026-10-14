// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { SendTimer } from './send-timer';

describe('SendTimer', () => {
  const clock = (...ticks: number[]) => {
    let index = 0;
    return () => ticks[Math.min(index++, ticks.length - 1)];
  };

  it('splits a media send into queue, save, upload and provider time', () => {
    // started 1010, saved 1030, uploaded 1230, delivered 1530, end 1540.
    const timer = new SendTimer(1000, clock(1010, 1030, 1230, 1530, 1540));
    timer.mark('saved');
    timer.mark('uploaded');
    timer.mark('delivered');

    expect(timer.summary()).toEqual({
      queueMs: 10,
      saveMs: 20,
      uploadMs: 200,
      providerMs: 300,
      totalMs: 540,
    });
  });

  it('leaves phases that did not run as null', () => {
    const timer = new SendTimer(undefined, clock(0, 5, 50, 60));
    timer.mark('saved');
    timer.mark('delivered');

    expect(timer.summary()).toEqual({
      queueMs: null,
      saveMs: 5,
      uploadMs: null,
      providerMs: 45,
      totalMs: 60,
    });
  });
});
