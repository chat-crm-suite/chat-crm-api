// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { registerAs } from '@nestjs/config';

export default registerAs('sentiment', () => ({
  apiUrl: process.env.IA_URL || 'http://localhost:8000',
  endpoint: `${process.env.IA_URL || 'http://localhost:8000'}/analyze_message`,
  // Shared secret sent as X-IA-Key; the production IA rejects calls without it.
  apiKey: process.env.IA_API_KEY || '',
}));