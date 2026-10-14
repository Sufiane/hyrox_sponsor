import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ConflictError, NotFoundError } from '../common/domain-error';
import type { DocumentKey } from '../common/document-key';
import type { RaceEntryId, StaffId } from '../common/ids';
import { StaffGuard } from '../staff-auth/staff.guard';
import type { ApproveVerificationDto } from './dto/approve-verification.dto';
import type { RaceEntryParamsDto } from './dto/race-entry-params.dto';
import type { RejectVerificationDto } from './dto/reject-verification.dto';
import { RaceEntryService, type AwaitingReviewItem, type DocumentAccess } from './race-entry.service';
import { StaffRaceEntryReviewController } from './staff-race-entry-review.controller';

describe('StaffRaceEntryReviewController', () => {
  const staffId = 'staff-1' as StaffId;
  const raceEntryId = 'entry-1' as RaceEntryId;
  const reviewedDocumentKey = 'race-entries/entry1/123e4567-e89b-12d3-a456-426614174000.pdf' as DocumentKey;
  const params = { raceEntryId } as RaceEntryParamsDto;
  let service: DeepMockProxy<RaceEntryService>;
  let controller: StaffRaceEntryReviewController;

  beforeEach(() => {
    service = mockDeep<RaceEntryService>();
    service.reviewVerification.mockResolvedValue(undefined);
    controller = new StaffRaceEntryReviewController(service);
  });

  describe('class metadata', () => {
    it('applies StaffGuard at class level', () => {
      const guards = Reflect.getMetadata('__guards__', StaffRaceEntryReviewController) as unknown[];

      expect(guards).toContain(StaffGuard);
    });

    it.each(['approve', 'reject'] as const)('responds 204 for %s', (method) => {
      const status = Reflect.getMetadata('__httpCode__', StaffRaceEntryReviewController.prototype[method]) as number;

      expect(status).toBe(204);
    });

    it('sets Cache-Control no-store on the document url route', () => {
      const headers = Reflect.getMetadata(
        '__headers__',
        StaffRaceEntryReviewController.prototype.getDocumentUrl,
      ) as { name: string; value: string }[];

      expect(headers).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    });
  });

  describe('listAwaitingReview', () => {
    it('returns the service result', async () => {
      const items = [{ raceEntryId }] as unknown as AwaitingReviewItem[];
      service.listAwaitingReview.mockResolvedValue(items);

      await expect(controller.listAwaitingReview()).resolves.toBe(items);
    });
  });

  describe('getDocumentUrl', () => {
    describe('when the entry has a document', () => {
      it('returns the access object', async () => {
        const access = { url: 'https://signed', expiresAt: new Date(), documentKey: reviewedDocumentKey } as DocumentAccess;
        service.getDocumentAccess.mockResolvedValue(access);

        await expect(controller.getDocumentUrl(params)).resolves.toBe(access);
        expect(service.getDocumentAccess).toHaveBeenCalledWith(raceEntryId);
      });
    });

    describe('when the document is missing', () => {
      it('propagates the error', async () => {
        service.getDocumentAccess.mockRejectedValue(new NotFoundError('verification_document_not_found'));

        await expect(controller.getDocumentUrl(params)).rejects.toThrow('verification_document_not_found');
      });
    });
  });

  describe('approve', () => {
    const body = { reviewedDocumentKey } as ApproveVerificationDto;

    describe('when the request is valid', () => {
      it('reviews as APPROVE with the guard staff id and resolves undefined', async () => {
        await expect(controller.approve(staffId, params, body)).resolves.toBeUndefined();

        expect(service.reviewVerification).toHaveBeenCalledWith({
          raceEntryId,
          decision: 'APPROVE',
          reviewerId: staffId,
          reviewedDocumentKey,
          reason: null,
        });
      });
    });

    describe('when the document changed', () => {
      it('propagates the conflict', async () => {
        service.reviewVerification.mockRejectedValue(new ConflictError('verification_document_changed'));

        await expect(controller.approve(staffId, params, body)).rejects.toThrow('verification_document_changed');
      });
    });
  });

  describe('reject', () => {
    const body = { reviewedDocumentKey, reason: 'blurry' } as RejectVerificationDto;

    describe('when the request is valid', () => {
      it('reviews as REJECT with the reason and the guard staff id', async () => {
        await expect(controller.reject(staffId, params, body)).resolves.toBeUndefined();

        expect(service.reviewVerification).toHaveBeenCalledWith({
          raceEntryId,
          decision: 'REJECT',
          reviewerId: staffId,
          reviewedDocumentKey,
          reason: 'blurry',
        });
      });
    });
  });
});
