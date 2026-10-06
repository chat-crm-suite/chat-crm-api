// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ClsModuleOptions } from "nestjs-cls";
import { setupHttpContext } from "./setups/cls/http.setup";
import { setupWsContext } from "./setups/cls/ws.setup";

export const clsConfig: ClsModuleOptions = {
  global: true,
  interceptor: {
    mount: true,
    setup: (cls, context) => {
      if (context.getType() === 'http') {
        setupHttpContext(cls, context)
      }
      if (context.getType() === 'ws') {
        setupWsContext(cls, context)
      }
    },
  },
};