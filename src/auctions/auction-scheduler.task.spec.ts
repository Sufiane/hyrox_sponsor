import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AuctionSchedulerTask } from './auction-scheduler.task';
import { AuctionService, type LifecycleTickResult } from './auction.service';

const emptyResult: LifecycleTickResult = { materialized: 0, opened: 0, closedWithWinner: 0, closedNoSale: 0 };

describe('AuctionSchedulerTask', () => {
  let service: DeepMockProxy<AuctionService>;
  let config: DeepMockProxy<ConfigService>;
  let task: AuctionSchedulerTask;
  let log: MockInstance;
  let error: MockInstance;

  beforeEach(async () => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = mockDeep<AuctionService>();
    config = mockDeep<ConfigService>();
    config.get.mockReturnValue(true);
    service.runLifecycleTick.mockResolvedValue(emptyResult);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuctionSchedulerTask,
        { provide: AuctionService, useValue: service },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    task = moduleRef.get(AuctionSchedulerTask);
    log.mockClear();
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
  });

  describe('when the scheduler is enabled', () => {
    it('runs a lifecycle tick', async () => {
      await task.tick();

      expect(service.runLifecycleTick).toHaveBeenCalledOnce();
    });
  });

  describe('when the scheduler is disabled', () => {
    beforeEach(() => {
      config.get.mockReturnValue(false);
    });

    it('does not run', async () => {
      await task.tick();

      expect(service.runLifecycleTick).not.toHaveBeenCalled();
    });
  });

  describe('when the previous tick is still running', () => {
    it('skips the overlapping tick', async () => {
      let release: () => void = () => undefined;
      service.runLifecycleTick.mockReturnValueOnce(
        new Promise((resolve) => {
          release = (): void => resolve(emptyResult);
        }),
      );

      const first = task.tick();
      await task.tick();
      release();
      await first;

      expect(service.runLifecycleTick).toHaveBeenCalledOnce();
    });
  });

  describe('when the tick changes something', () => {
    beforeEach(() => {
      service.runLifecycleTick.mockResolvedValue({ ...emptyResult, opened: 9 });
    });

    it('logs the counts', async () => {
      await task.tick();

      expect(log).toHaveBeenCalledWith(expect.stringContaining('opened=9'));
    });
  });

  describe('when the tick changes nothing', () => {
    it('stays quiet', async () => {
      await task.tick();

      expect(log).not.toHaveBeenCalled();
    });
  });

  describe('when the service throws', () => {
    beforeEach(() => {
      service.runLifecycleTick.mockRejectedValue(new Error('db down'));
    });

    it('swallows and logs the error', async () => {
      await expect(task.tick()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });

    it('allows the next tick to run', async () => {
      await task.tick();
      service.runLifecycleTick.mockResolvedValue(emptyResult);
      await task.tick();

      expect(service.runLifecycleTick).toHaveBeenCalledTimes(2);
    });
  });
});
