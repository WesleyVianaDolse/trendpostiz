import { Injectable } from '@nestjs/common';
import { lstat, realpath, unlink } from 'fs/promises';
import path from 'path';
import { UploadFactory } from './upload.factory';

@Injectable()
export class OrganizationFilesService {
  async removeOwnedFile(value: string) {
    if (!value || /^(data:|blob:)/i.test(value)) return;
    const provider = process.env.STORAGE_PROVIDER;
    const publicRoot =
      provider === 'local'
        ? `${process.env.FRONTEND_URL?.replace(/\/+$/, '')}/uploads/`
        : `${process.env.CLOUDFLARE_BUCKET_URL?.replace(/\/+$/, '')}/`;
    const root = new URL(publicRoot);
    let url: URL;
    try {
      url = new URL(value, root);
    } catch {
      return;
    }
    // External links and social-network profile pictures are not application-owned files.
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
      return;
    const relative = decodeURIComponent(
      url.pathname.slice(root.pathname.length)
    );
    if (
      !relative ||
      relative
        .split(/[\\/]/)
        .some((segment) => !segment || segment === '.' || segment === '..') ||
      relative.includes('\0')
    ) {
      throw new Error('Unsafe media path');
    }
    if (provider === 'cloudflare') {
      await UploadFactory.createStorage().removeFile(url.origin + url.pathname);
      return;
    }
    if (provider !== 'local' || !process.env.UPLOAD_DIRECTORY)
      throw new Error('Storage is not configured');
    const storageRoot = path.resolve(process.env.UPLOAD_DIRECTORY);
    const candidate = path.resolve(storageRoot, relative);
    const inside = path.relative(storageRoot, candidate);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside))
      throw new Error('Unsafe media path');
    try {
      const [actualRoot, actualFile, info] = await Promise.all([
        realpath(storageRoot),
        realpath(candidate),
        lstat(candidate),
      ]);
      const resolved = path.relative(actualRoot, actualFile);
      if (
        !resolved ||
        resolved.startsWith('..') ||
        path.isAbsolute(resolved) ||
        info.isSymbolicLink() ||
        !info.isFile()
      )
        throw new Error('Unsafe media path');
      await unlink(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
