import { GUARDS_METADATA, HEADERS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { RaceResultId, StaffId } from '../common/ids';
import { StaffGuard } from '../staff-auth/staff.guard';
import type { RaceResultIdParamsDto } from './dto/race-result-id-params.dto';
import type { ApproveRaceResultDto, RejectRaceResultDto } from './dto/review-race-result.dto';
import { RaceResultService } from './race-result.service';
import { StaffRaceResultReviewController } from './staff-race-result-review.controller';

describe('StaffRaceResultReviewController', () => {
  const staffId = 'staff-1' as StaffId;
  const raceResultId = 'result-1' as RaceResultId;
  const params = { raceResultId } as RaceResultIdParamsDto;
  const submittedAt = new Date('2026-10-02T09:00:00.123Z');
  let service: DeepMockProxy<RaceResultService>;
  let controller: StaffRaceResultReviewController;

  beforeEach(() => {
    service = mockDeep<RaceResultService>();
    controller = new StaffRaceResultReviewController(service);
  });

  it('is guarded by StaffGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StaffRaceResultReviewController)).toEqual([StaffGuard]);
  });

  describe('listAwaitingReview', () => {
    it('wraps the queue in items', async () => {
      service.listAwaitingReview.mockResolvedValue([]);

      await expect(controller.listAwaitingReview()).resolves.toEqual({ items: [] });
    });
  });

  describe('getDetail', () => {
    it('delegates and is marked no-store', async () => {
      await controller.getDetail(params);

      expect(service.getStaffDetail).toHaveBeenCalledWith(raceResultId);
      expect(Reflect.getMetadata(HEADERS_METADATA, controller.getDetail)).toEqual([
        { name: 'Cache-Control', value: 'no-store' },
      ]);
    });
  });

  describe('approve', () => {
    it('delegates with the reviewer from the decorator and answers 204', async () => {
      await controller.approve(staffId, params, { submittedAt } as ApproveRaceResultDto);

      expect(service.review).toHaveBeenCalledWith({
        raceResultId,
        decision: 'APPROVE',
        reviewerId: staffId,
        expectedSubmittedAt: submittedAt,
        reason: null,
      });
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.approve)).toBe(204);
    });
  });

  describe('reject', () => {
    it('delegates with the reason and answers 204', async () => {
      await controller.reject(staffId, params, { submittedAt, reason: 'blurry' } as RejectRaceResultDto);

      expect(service.review).toHaveBeenCalledWith({
        raceResultId,
        decision: 'REJECT',
        reviewerId: staffId,
        expectedSubmittedAt: submittedAt,
        reason: 'blurry',
      });
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.reject)).toBe(204);
    });
  });
});
