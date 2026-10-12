import { TOS_DRAFT_NOTICE, TOS_SECTIONS } from './terms.ts';

const REQUIRED_IDS = [
  'eligibility',
  'trademark',
  'auctions',
  'bids',
  'payments',
  'obligations',
  'disputes',
  'liability',
];

describe('TOS_SECTIONS', () => {
  describe('when listed', () => {
    it('has unique ids', () => {
      const ids = TOS_SECTIONS.map((section) => section.id);

      expect(new Set(ids).size).toBe(ids.length);
    });

    it('has a non-empty heading on every section', () => {
      for (const section of TOS_SECTIONS) {
        expect(section.heading.trim()).not.toBe('');
      }
    });

    it('has at least one non-empty paragraph on every section', () => {
      for (const section of TOS_SECTIONS) {
        expect(section.paragraphs.length).toBeGreaterThan(0);

        for (const paragraph of section.paragraphs) {
          expect(paragraph.trim()).not.toBe('');
        }
      }
    });

    it('covers the required topics', () => {
      const ids = TOS_SECTIONS.map((section) => section.id);

      expect(ids).toEqual(expect.arrayContaining(REQUIRED_IDS));
    });
  });
});

describe('TOS_DRAFT_NOTICE', () => {
  describe('when set', () => {
    it('flags the copy as a draft and not legal advice', () => {
      expect(TOS_DRAFT_NOTICE).toContain('DRAFT');
      expect(TOS_DRAFT_NOTICE).toContain('not legal advice');
    });
  });
});
