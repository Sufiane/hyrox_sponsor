import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { BidderService } from './bidder.service.js';
import { BidderDb } from './bidder.db.js';

describe('BidderService', () => {
  let db: DeepMockProxy<BidderDb>;
  let service: BidderService;

  beforeEach(async () => {
    db = mockDeep<BidderDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [BidderService, { provide: BidderDb, useValue: db }],
    }).compile();
    service = moduleRef.get(BidderService);
  });

  describe('getOrCreateByEmail', () => {
    describe('when the email is already normalised', () => {
      const bidder = { id: 'bidder-1', email: 'brand@example.com' };

      beforeEach(() => {
        db.upsertByEmail.mockResolvedValue(bidder as never);
      });

      it('upserts it unchanged and returns the bidder', async () => {
        const result = await service.getOrCreateByEmail('brand@example.com');

        expect(db.upsertByEmail).toHaveBeenCalledWith('brand@example.com');
        expect(result).toEqual(bidder);
      });
    });

    describe('when the email has mixed case and surrounding whitespace', () => {
      beforeEach(() => {
        db.upsertByEmail.mockResolvedValue({} as never);
      });

      it('upserts the trimmed lowercase email', async () => {
        await service.getOrCreateByEmail('  Jamie@Example.COM ');

        expect(db.upsertByEmail).toHaveBeenCalledWith('jamie@example.com');
      });
    });
  });
});
