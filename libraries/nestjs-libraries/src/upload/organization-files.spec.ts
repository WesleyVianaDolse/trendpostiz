import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { OrganizationFilesService } from './organization-files.service';
import { CloudflareStorage } from './cloudflare.storage';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

describe('physical media deletion boundaries', () => {
  let base: string;
  const environment = { ...process.env };
  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'trendpostiz-file-delete-'));
    process.env.UPLOAD_DIRECTORY = path.join(base, 'uploads');
    process.env.FRONTEND_URL = 'https://app.example.test';
    process.env.STORAGE_PROVIDER = 'local';
    await mkdir(path.join(base, 'uploads/2026'), { recursive: true });
    await writeFile(path.join(base, 'private.txt'), 'preserve');
  });
  afterAll(async () => {
    for (const key of ['UPLOAD_DIRECTORY', 'FRONTEND_URL', 'STORAGE_PROVIDER'])
      if (environment[key] === undefined) delete process.env[key];
      else process.env[key] = environment[key];
    if (
      base &&
      path
        .resolve(base)
        .startsWith(path.resolve(tmpdir(), 'trendpostiz-file-delete-'))
    )
      await rm(base, { recursive: true, force: true });
  });
  it('deletes the exact owned upload and treats an already absent file as success', async () => {
    const service = new OrganizationFilesService();
    await writeFile(path.join(base, 'uploads/2026/owned.png'), 'private-media');
    await service.removeOwnedFile(
      'https://app.example.test/uploads/2026/owned.png'
    );
    await expect(
      readFile(path.join(base, 'uploads/2026/owned.png'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      service.removeOwnedFile('https://app.example.test/uploads/2026/owned.png')
    ).resolves.toBeUndefined();
  });
  it('cannot traverse out of uploads or remove files from external URLs', async () => {
    const service = new OrganizationFilesService();
    await expect(
      service.removeOwnedFile(
        'https://app.example.test/uploads/..%2Fprivate.txt'
      )
    ).rejects.toThrow('Unsafe media path');
    await service.removeOwnedFile(
      'https://external.example.test/uploads/private.txt'
    );
    await service.removeOwnedFile(
      'https://app.example.test/uploads/../private.txt'
    );
    expect(await readFile(path.join(base, 'private.txt'), 'utf8')).toBe(
      'preserve'
    );
  });
  it('physically deletes the exact Cloudflare object and rejects a different bucket URL', async () => {
    const send = jest.spyOn(
      S3Client.prototype,
      'send'
    ) as unknown as jest.SpyInstance;
    send.mockResolvedValue({});
    try {
      const storage = new CloudflareStorage(
        'test-account',
        'test-key',
        'test-secret',
        'auto',
        'isolated-bucket',
        'https://storage.example.test/assets'
      );
      await storage.removeFile('https://storage.example.test/assets/media.png');
      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'isolated-bucket',
        Key: 'media.png',
      });
      await expect(
        storage.removeFile('https://another.example.test/assets/media.png')
      ).rejects.toThrow('Invalid storage URL');
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
    }
  });
});
