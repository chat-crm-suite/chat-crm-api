// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { open, readFile, rm, writeFile } from 'node:fs/promises';

import {
  channelCapabilities,
  type ChannelCapabilities,
  type StagedUpload,
  type StageUploadInput,
  type UploadErrorCode,
} from '@contracts';
import { readImageInfo, type ImageInfo } from '@modules/media/inspect/image-info';
import {
  displayFilename,
  extensionFor,
} from '@modules/media/inspect/media-file-name';
import {
  SNIFF_BYTES,
  trustedMimeType,
} from '@modules/media/inspect/media-sniffer';
import { isFragmentedMp4 } from '@modules/media/inspect/mp4-layout';
import {
  MediaNormalizerChain,
  type MediaFile,
  type MediaNormalizer,
  type NormalizedMedia,
} from '@modules/media/normalize/media-normalizer';
import {
  StagedUploadStore,
  type StagedFile,
} from '@modules/media/staging/staged-upload.store';
import { ConversationSendContextService } from '../send-context/conversation-send-context.service';

/** A file multer wrote to the temp dir. */
export interface IncomingUpload {
  path: string;
  size: number;
  mimetype: string;
  originalname: string;
}

/** The checked file, ready to stage. */
interface InspectedFile {
  sourcePath: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  durationMs: number | null;
  image: ImageInfo | null;
}

/**
 * Stages a file an agent attaches to a conversation, validated against what
 * the conversation's channel accepts: content-sniffed type (the browser's
 * claim is never trusted), size per kind, sticker geometry. Files the
 * channel cannot take as recorded (Chrome voice notes) are normalized first.
 */
@Injectable()
export class ConversationUploadsService {
  constructor(
    private readonly sendContext: ConversationSendContextService,
    private readonly store: StagedUploadStore,
    private readonly normalizers: MediaNormalizerChain,
  ) {}

  async stage(
    conversationId: string,
    companyId: string,
    upload: IncomingUpload,
    input: StageUploadInput,
  ): Promise<StagedUpload> {
    const normalizedPath = `${upload.path}.normalized`;

    try {
      const context = await this.sendContext.get(conversationId);
      if (!context || context.companyId !== companyId) {
        throw new NotFoundException('Conversation not found');
      }

      const capabilities = channelCapabilities(context.channelType);
      const file = await this.inspect(
        upload,
        input,
        capabilities,
        normalizedPath,
      );

      const staged = await this.store.stage({
        companyId,
        conversationId,
        kind: input.kind,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        filename: displayFilename(upload.originalname, file.extension),
        extension: file.extension,
        durationMs: file.durationMs,
        width: file.image?.width ?? null,
        height: file.image?.height ?? null,
        sourcePath: file.sourcePath,
      });

      return toStagedUpload(staged);
    } finally {
      // The normalized copy is ours; the upload itself belongs to the caller.
      await rm(normalizedPath, { force: true });
    }
  }

  private async inspect(
    upload: IncomingUpload,
    input: StageUploadInput,
    capabilities: ChannelCapabilities | null,
    normalizedPath: string,
  ): Promise<InspectedFile> {
    const rule = capabilities?.media[input.kind];
    if (!capabilities || !rule) {
      throw refusal(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'channel_unsupported',
        `This channel cannot send ${input.kind} files`,
      );
    }

    const head = await readHead(upload.path);
    const detected = trustedMimeType(upload.mimetype, head);
    if (!detected) {
      throw refusal(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'content_mismatch',
        'The file content is not a supported type',
      );
    }

    let file: InspectedFile = {
      sourcePath: upload.path,
      mimeType: detected,
      extension: extensionFor(detected),
      sizeBytes: upload.size,
      durationMs: input.durationMs ?? null,
      image: readImageInfo(detected, head),
    };

    const normalizer = this.normalizers.find(detected, rule.mimeTypes);
    if (normalizer) {
      const output = await normalizeOrRefuse(normalizer, {
        data: await readFile(upload.path),
        mimeType: detected,
      });
      await writeFile(normalizedPath, output.data);
      file = {
        ...file,
        sourcePath: normalizedPath,
        mimeType: output.mimeType,
        extension: output.extension,
        sizeBytes: output.data.length,
        durationMs: output.durationMs ?? file.durationMs,
      };
    }

    if (!rule.mimeTypes.includes(file.mimeType)) {
      throw refusal(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'type_not_allowed',
        `${file.mimeType} cannot be sent as ${input.kind}`,
      );
    }
    if (file.sizeBytes > rule.maxBytes) {
      throw refusal(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'too_large',
        `${input.kind} files are limited to ${rule.maxBytes} bytes`,
      );
    }
    if (rule.progressiveOnly && isFragmentedMp4(head)) {
      throw refusal(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'fragmented_video',
        'Fragmented MP4 (browser recordings) cannot be sent on this channel',
      );
    }
    if (input.kind === 'sticker') assertSticker(file, capabilities);

    return file;
  }
}

/** WhatsApp stickers: square 512×512 webp, smaller cap when not animated. */
function assertSticker(
  file: InspectedFile,
  capabilities: ChannelCapabilities,
): void {
  const rules = capabilities.sticker;
  if (!rules) return;

  const { image } = file;
  if (!image || image.width !== rules.width || image.height !== rules.height) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'sticker_dimensions',
      `Stickers must be ${rules.width}x${rules.height} pixels`,
    );
  }

  const maxBytes = image.animated ? rules.maxAnimatedBytes : rules.maxStaticBytes;
  if (file.sizeBytes > maxBytes) {
    throw refusal(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'sticker_too_large',
      `${image.animated ? 'Animated' : 'Static'} stickers are limited to ${maxBytes} bytes`,
    );
  }
}

/**
 * A refused upload: HTTP status plus a stable `code` the app translates for
 * the agent (the `message` stays the developer-facing English).
 */
function refusal(
  status: HttpStatus,
  code: UploadErrorCode,
  message: string,
): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

/** A file the normalizer cannot read (corrupt, unsupported layout) is refused. */
function normalizeOrRefuse(
  normalizer: MediaNormalizer,
  file: MediaFile,
): Promise<NormalizedMedia> {
  try {
    return Promise.resolve(normalizer.normalize(file));
  } catch (error: unknown) {
    throw refusal(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'unreadable',
      `The file could not be converted: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readHead(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function toStagedUpload(staged: StagedFile): StagedUpload {
  return {
    uploadId: staged.uploadId,
    kind: staged.kind,
    mimeType: staged.mimeType,
    sizeBytes: staged.sizeBytes,
    filename: staged.filename,
    durationMs: staged.durationMs,
    width: staged.width,
    height: staged.height,
    expiresAt: new Date(staged.expiresAt),
  };
}
