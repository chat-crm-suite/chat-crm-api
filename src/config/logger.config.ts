// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Params } from "nestjs-pino";

process.env.TZ = process.env.APP_TZ || 'America/Lima'; // timezone

export const loggerConfig: Params = {
  pinoHttp: {
    level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: {
        singleLine: true,
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname,context,http,statusCode',
        levelFirst: true,
        messageFormat: '{if context}{context} | {end}{if http}{http} {end}{msg}{end}',
        customColors: 'error:red,info:cyan,debug:blue,warn:yellow',
      },
    } : undefined,
    customProps: (req, res) => ({
      http: `[${req.url}, ${req.method}, ${res.statusCode}]`,
    }),
  },
};
