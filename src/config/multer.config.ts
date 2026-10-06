// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { diskStorage } from 'multer';
import { join, parse } from 'path';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { format } from 'date-fns';

export const multerConfig: MulterOptions = {
  storage: diskStorage({
    destination: join(process.cwd(), 'uploads'),
    filename: (req, file, cb) => {
      const { name, ext } = parse(file.originalname);
      const uniqueSuffix = format(Date.now(), 'yyyy-MM-dd') + '-' + name;
      cb(null, `${uniqueSuffix}${ext}`);
    },
  }),
};