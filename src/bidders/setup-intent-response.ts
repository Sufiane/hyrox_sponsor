import type { BidderToken } from '../common/bidder-token';
import type { CreatePaymentSetupResult } from './usecases/create-payment-setup/create-payment-setup.usecase';

export type SetupIntentResponse = {
  clientSecret: string;
  bidderToken: BidderToken;
  bidderTokenExpiresAt: string;
};

export function toSetupIntentResponse(result: CreatePaymentSetupResult): SetupIntentResponse {
  return {
    clientSecret: result.clientSecret,
    bidderToken: result.bidderToken,
    bidderTokenExpiresAt: result.bidderTokenExpiresAt.toISOString(),
  };
}
