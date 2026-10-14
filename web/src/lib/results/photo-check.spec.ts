import { photoProblem } from './photo-check.ts';

describe('photoProblem', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(photoProblem({ type, size: 1_000 })).toBeNull();
  });

  it('accepts exactly 10 MiB', () => {
    expect(photoProblem({ type: 'image/png', size: 10_485_760 })).toBeNull();
  });

  describe('when the type is unsupported', () => {
    it('explains the allowed types', () => {
      expect(photoProblem({ type: 'application/pdf', size: 1_000 })).toMatch(/JPEG, PNG or WebP/);
    });
  });

  describe('when the file is empty', () => {
    it('rejects it', () => {
      expect(photoProblem({ type: 'image/png', size: 0 })).toMatch(/empty/);
    });
  });

  describe('when the file is over 10 MiB', () => {
    it('rejects it', () => {
      expect(photoProblem({ type: 'image/png', size: 10_485_761 })).toMatch(/10 MB/);
    });
  });
});
