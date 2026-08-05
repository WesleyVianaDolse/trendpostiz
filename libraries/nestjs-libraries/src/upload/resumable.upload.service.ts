import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';
import { pipeline } from 'stream/promises';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

// Keep chunks small enough for mobile networks and comfortably below proxy limits.
const CHUNK_SIZE = 5 * 1024 * 1024;
const LEGACY_CHUNK_SIZE = 8 * 1024 * 1024;
// This is deliberately larger than CHUNK_SIZE. Multer treats reaching fileSize
// exactly as LIMIT_FILE_SIZE, and multipart/form-data also adds request overhead.
export const MAX_RESUMABLE_CHUNK_REQUEST_SIZE = 12 * 1024 * 1024;
const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const UPLOAD_ID_PATTERN = /^[a-f0-9-]{36}$/;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'video/quicktime',
]);

interface UploadMetadata {
  uploadId: string;
  organizationId: string;
  originalName: string;
  size: number;
  type: string;
  totalParts: number;
  chunkSize?: number;
  createdAt: string;
  completedPath?: string;
  completedName?: string;
}

@Injectable()
export class ResumableUploadService {
  get chunkSize() {
    return CHUNK_SIZE;
  }

  async initialize(
    organizationId: string,
    input: {
      uploadId?: string;
      originalName: string;
      size: number;
      type: string;
    }
  ) {
    const size = Number(input.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_SIZE) {
      throw new BadRequestException('Invalid or unsupported file size.');
    }

    if (!input.originalName || input.originalName.length > 255) {
      throw new BadRequestException('Invalid file name.');
    }

    if (input.uploadId && UPLOAD_ID_PATTERN.test(input.uploadId)) {
      const existing = await this.readMetadata(input.uploadId).catch(
        () => null
      );
      if (
        existing &&
        existing.organizationId === organizationId &&
        existing.size === size &&
        existing.originalName === input.originalName
      ) {
        return {
          uploadId: existing.uploadId,
          chunkSize: this.metadataChunkSize(existing),
          uploadedParts: await this.listUploadedParts(existing),
          completed: !!existing.completedPath,
        };
      }
    }

    const uploadId = randomUUID();
    const metadata: UploadMetadata = {
      uploadId,
      organizationId,
      originalName: input.originalName,
      size,
      type: input.type || 'application/octet-stream',
      totalParts: Math.ceil(size / CHUNK_SIZE),
      chunkSize: CHUNK_SIZE,
      createdAt: new Date().toISOString(),
    };
    await mkdir(this.uploadPath(uploadId), { recursive: true });
    await this.writeMetadata(metadata);

    return {
      uploadId,
      chunkSize: CHUNK_SIZE,
      uploadedParts: [],
      completed: false,
    };
  }

  async saveChunk(
    organizationId: string,
    uploadId: string,
    partNumberValue: string,
    chunk: Express.Multer.File
  ) {
    const metadata = await this.authorizedMetadata(organizationId, uploadId);
    const partNumber = Number(partNumberValue);
    if (
      !Number.isInteger(partNumber) ||
      partNumber < 0 ||
      partNumber >= metadata.totalParts
    ) {
      throw new BadRequestException('Invalid upload part.');
    }
    if (
      !chunk?.buffer?.length ||
      chunk.size > this.metadataChunkSize(metadata)
    ) {
      throw new BadRequestException('Invalid upload chunk.');
    }

    const expectedSize =
      partNumber === metadata.totalParts - 1
        ? metadata.size - partNumber * this.metadataChunkSize(metadata)
        : this.metadataChunkSize(metadata);
    if (chunk.size !== expectedSize) {
      throw new BadRequestException('Upload chunk has an unexpected size.');
    }

    const finalPath = this.partPath(uploadId, partNumber);
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, chunk.buffer, { flag: 'wx' });
    await rename(temporaryPath, finalPath);
    return { uploaded: true, partNumber };
  }

  async complete(organizationId: string, uploadId: string) {
    const metadata = await this.authorizedMetadata(organizationId, uploadId);
    if (metadata.completedPath && metadata.completedName) {
      return {
        path: metadata.completedPath,
        name: metadata.completedName,
        originalName: metadata.originalName,
      };
    }

    const uploadedParts = await this.listUploadedParts(metadata);
    if (uploadedParts.length !== metadata.totalParts) {
      throw new BadRequestException('Upload is incomplete.');
    }

    const firstPart = await readFile(this.partPath(uploadId, 0));
    const detected = await fromBuffer(firstPart.subarray(0, 4100));
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new BadRequestException('Unsupported file type.');
    }

    const safeName = `${randomUUID().replace(/-/g, '')}.${detected.ext}`;
    const now = new Date();
    const innerDirectory = `/${now.getFullYear()}/${String(
      now.getMonth() + 1
    ).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    const destinationDirectory = `${this.uploadDirectory}${innerDirectory}`;
    const temporaryDestination = path.join(
      destinationDirectory,
      `.${safeName}.${uploadId}.tmp`
    );
    const destination = path.join(destinationDirectory, safeName);
    await mkdir(destinationDirectory, { recursive: true });

    try {
      for (let part = 0; part < metadata.totalParts; part++) {
        await pipeline(
          createReadStream(this.partPath(uploadId, part)),
          createWriteStream(temporaryDestination, {
            flags: part === 0 ? 'wx' : 'a',
          })
        );
      }
      await rename(temporaryDestination, destination);
    } catch (error) {
      await rm(temporaryDestination, { force: true });
      throw error;
    }

    const completedStats = await stat(destination);
    if (completedStats.size !== metadata.size) {
      await rm(destination, { force: true });
      throw new BadRequestException('Completed upload size does not match.');
    }

    metadata.completedName = safeName;
    metadata.completedPath = `${process.env.FRONTEND_URL}/uploads${innerDirectory}/${safeName}`;
    await this.writeMetadata(metadata);
    await this.removeParts(metadata);
    return {
      path: metadata.completedPath,
      name: metadata.completedName,
      originalName: metadata.originalName,
    };
  }

  async abort(organizationId: string, uploadId: string) {
    const metadata = await this.authorizedMetadata(organizationId, uploadId);
    if (!metadata.completedPath) {
      await rm(this.uploadPath(uploadId), { recursive: true, force: true });
    }
    return { aborted: !metadata.completedPath };
  }

  private get uploadDirectory() {
    if (!process.env.UPLOAD_DIRECTORY) {
      throw new Error('UPLOAD_DIRECTORY is not configured.');
    }
    return path.resolve(process.env.UPLOAD_DIRECTORY);
  }

  private get temporaryDirectory() {
    return path.join(this.uploadDirectory, '.resumable-uploads');
  }

  private uploadPath(uploadId: string) {
    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      throw new BadRequestException('Invalid upload identifier.');
    }
    return path.join(this.temporaryDirectory, uploadId);
  }

  private metadataPath(uploadId: string) {
    return path.join(this.uploadPath(uploadId), 'metadata.json');
  }

  private partPath(uploadId: string, partNumber: number) {
    return path.join(this.uploadPath(uploadId), `${partNumber}.part`);
  }

  private async writeMetadata(metadata: UploadMetadata) {
    await writeFile(
      this.metadataPath(metadata.uploadId),
      JSON.stringify(metadata),
      'utf8'
    );
  }

  private async readMetadata(uploadId: string): Promise<UploadMetadata> {
    try {
      return JSON.parse(await readFile(this.metadataPath(uploadId), 'utf8'));
    } catch {
      throw new NotFoundException('Upload not found.');
    }
  }

  private async authorizedMetadata(organizationId: string, uploadId: string) {
    const metadata = await this.readMetadata(uploadId);
    if (metadata.organizationId !== organizationId) {
      throw new NotFoundException('Upload not found.');
    }
    return metadata;
  }

  private async listUploadedParts(metadata: UploadMetadata) {
    const parts: number[] = [];
    for (let part = 0; part < metadata.totalParts; part++) {
      const expectedSize =
        part === metadata.totalParts - 1
          ? metadata.size - part * this.metadataChunkSize(metadata)
          : this.metadataChunkSize(metadata);
      const partStats = await stat(
        this.partPath(metadata.uploadId, part)
      ).catch(() => null);
      if (partStats?.size === expectedSize) {
        parts.push(part);
      }
    }
    return parts;
  }

  private metadataChunkSize(metadata: UploadMetadata) {
    return metadata.chunkSize || LEGACY_CHUNK_SIZE;
  }

  private async removeParts(metadata: UploadMetadata) {
    await Promise.all(
      Array.from({ length: metadata.totalParts }, (_, part) =>
        rm(this.partPath(metadata.uploadId, part), { force: true })
      )
    );
  }
}
