// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Params } from 'nestjs-pino';

process.env.TZ = process.env.APP_TZ || 'America/Lima'; // timezone

/** Environment subset that decides the logger shape. */
export interface LoggerEnv {
  NODE_ENV?: string;
  LOG_PRETTY?: string;
}

/**
 * Canonical order of the domain fields in every log line (T5). Unknown fields
 * keep the order the call site gave them, after these.
 */
const CORRELATION_FIELDS = [
  'context',
  'analysisId',
  'messageId',
  'attachmentId',
  'mediaId',
  'type',
  'conversationId',
  'durationMs',
  'reason',
] as const;

/**
 * Rebuilds the log object with the correlation fields first, so JSON lines are
 * searchable by a stable prefix regardless of the call site. Everything else
 * (including `err`) keeps call-site order; pino appends `msg` last.
 */
function orderLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};

  for (const key of CORRELATION_FIELDS) {
    if (key in fields) ordered[key] = fields[key];
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!(key in ordered)) ordered[key] = value;
  }

  return ordered;
}

/** Pretty output is the development default; `LOG_PRETTY` overrides it. */
function usePretty(env: LoggerEnv): boolean {
  const flag = env.LOG_PRETTY?.trim().toLowerCase();

  if (flag === 'true') return true;
  if (flag === 'false') return false;

  return env.NODE_ENV !== 'production';
}

export function buildLoggerConfig(env: LoggerEnv = process.env): Params {
  return {
    pinoHttp: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: usePretty(env)
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
              ignore: 'pid,hostname,context,http,statusCode',
              levelFirst: true,
              messageFormat:
                '{if context}{context} | {end}{if http}{http} {end}{msg}{end}',
              customColors: 'error:red,info:cyan,debug:blue,warn:yellow',
            },
          }
        : undefined,
      customProps: (req, res) => ({
        http: `[${req.url}, ${req.method}, ${res.statusCode}]`,
      }),
      formatters: {
        log: orderLogFields,
      },
    },
  };
}

export const loggerConfig: Params = buildLoggerConfig();
