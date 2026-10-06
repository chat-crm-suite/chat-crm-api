// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

export type HttpRequestCompany = Request & {
  headers: { 'x-company-id': string },
  companyId: string
}

interface WsClient {
  handshake?: {
    headers?: Record<string, string>
  };
  companyId?: string;
}

interface WsData {
  companyId?: string;
}

@Injectable()
export class CompanyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    // const req = context.switchToHttp().getRequest<HttpRequestCompany>();
    // const companyId = req.headers['x-company-id'];
    let companyId: string | undefined;

    switch (context.getType()) {
      case 'http': {
        const req = context.switchToHttp().getRequest<HttpRequestCompany>();
        companyId = req.headers['x-company-id'];
        break;
      }
      case 'ws': {
        const client = context.switchToWs().getClient<WsClient>();
        const data = context.switchToWs().getData<WsData>();
        companyId = client.handshake?.headers?.['x-company-id'] ?? data?.companyId;
        if (!companyId) {
          throw new WsException('Company context required');
        }
        break;
      }
      default:
        throw new ForbiddenException('Unsupported context');
    }

    if (!companyId) throw new ForbiddenException('Company context required');

    return true;
  }
}
