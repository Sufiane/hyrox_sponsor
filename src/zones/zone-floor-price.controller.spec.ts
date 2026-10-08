import { UnauthorizedException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { AthleteId } from '../common/ids';
import { cents } from '../common/money';
import type { SetFloorPriceDto } from './dto/set-floor-price.dto';
import type { ZoneParamDto } from './dto/zone-param.dto';
import { ZoneFloorPriceController } from './zone-floor-price.controller';
import { ZoneFloorPriceService, type ZoneFloorPriceView } from './zone-floor-price.service';

describe('ZoneFloorPriceController', () => {
  const athleteId = 'athlete-1' as AthleteId;
  const view: ZoneFloorPriceView = { zone: 'LEFT_PEC', floorPriceCents: cents(2500), isDefault: false };
  let service: DeepMockProxy<ZoneFloorPriceService>;
  let controller: ZoneFloorPriceController;

  beforeEach(() => {
    service = mockDeep<ZoneFloorPriceService>();
    controller = new ZoneFloorPriceController(service);
  });

  describe('list', () => {
    describe('when the athlete id is undefined', () => {
      it('throws invalid_token', async () => {
        await expect(controller.list(undefined)).rejects.toThrow(UnauthorizedException);
        await expect(controller.list(undefined)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the request is authenticated', () => {
      beforeEach(() => {
        service.listForAthlete.mockResolvedValue([view]);
      });

      it('returns the prices of the token athlete', async () => {
        const result = await controller.list(athleteId);

        expect(service.listForAthlete).toHaveBeenCalledWith(athleteId);
        expect(result).toEqual({ prices: [view] });
      });
    });
  });

  describe('set', () => {
    const params = { zone: 'LEFT_PEC' } as ZoneParamDto;
    const body = { floorPriceCents: 2500 } as SetFloorPriceDto;

    describe('when the athlete id is undefined', () => {
      it('throws invalid_token', async () => {
        await expect(controller.set(undefined, params, body)).rejects.toThrow(UnauthorizedException);
        await expect(controller.set(undefined, params, body)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the request is authenticated', () => {
      beforeEach(() => {
        service.setFloorPrice.mockResolvedValue(view);
      });

      it('saves the price for the path zone and returns the entry', async () => {
        const result = await controller.set(athleteId, params, body);

        expect(service.setFloorPrice).toHaveBeenCalledWith(athleteId, 'LEFT_PEC', 2500);
        expect(result).toBe(view);
      });
    });
  });
});
