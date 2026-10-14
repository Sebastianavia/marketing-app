import { avatarDir, avatarPhotoPath, type Avatar } from './avatar-store';
import { localMediaUrl } from '@/lib/storage/generated-library';

/** Lo que ve el navegador: el avatar con URLs para mostrar sus fotos. */
export interface AvatarDto extends Avatar {
  dir: string;
  coverUrl: string | null;
  photoUrls: Array<{ file: string; url: string }>;
}

export async function toAvatarDto(a: Avatar): Promise<AvatarDto> {
  const photoUrls = await Promise.all(
    a.photos.map(async (p) => ({ file: p.file, url: localMediaUrl(await avatarPhotoPath(a.id, p.file)) }))
  );
  return {
    ...a,
    dir: await avatarDir(a.id),
    coverUrl: photoUrls.find((p) => p.file === a.cover)?.url ?? photoUrls[0]?.url ?? null,
    photoUrls,
  };
}
