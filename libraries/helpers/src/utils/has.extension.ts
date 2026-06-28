export const hasExtension = (
  path: string | undefined | null,
  extension: string
): boolean => {
  return hasAnyExtension(path, [extension]);
};

export const hasAnyExtension = (
  path: string | undefined | null,
  extensions: string[]
): boolean => {
  if (!path) {
    return false;
  }
  const cleanPath = path.split('?')[0].split('#')[0].toLowerCase();
  return extensions.some((extension) => {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    return cleanPath.endsWith(ext.toLowerCase());
  });
};

export const isVideoExtension = (path: string | undefined | null): boolean =>
  hasAnyExtension(path, ['mp4', 'mov']);
