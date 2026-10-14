import { MAX_PHOTO_BYTES, PHOTO_TYPES } from './results-types.ts';

export function photoProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return 'Photo must be a JPEG, PNG or WebP image.';
  }

  if (file.size === 0) {
    return 'That photo is empty. Choose another one.';
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return 'That photo is larger than 10 MB. Choose a smaller one.';
  }

  return null;
}
