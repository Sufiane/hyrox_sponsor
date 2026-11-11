import { Injectable, Logger } from '@nestjs/common';
import { AthleteDb, type AthleteRow } from '../athletes/athlete.db';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/domain-error';
import { normalizeEmail } from '../common/email';
import type { AthleteId } from '../common/ids';
import type { StripeConnectAccountId } from '../common/stripe-ids';
import { StripeGateway, type OnboardingLink } from '../stripe/stripe-gateway';
import { connectStatus, type ConnectStatus } from './connect-status';

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    private readonly athletes: AthleteDb,
    private readonly gateway: StripeGateway,
  ) {}

  async createOnboardingLink(athleteId: AthleteId): Promise<OnboardingLink> {
    const athlete = await this.loadEligibleAthlete(athleteId);
    const accountId = athlete.stripeConnectAccountId ?? (await this.provisionAccount(athlete));

    return this.gateway.createOnboardingLink(accountId);
  }

  async getStatus(athleteId: AthleteId): Promise<ConnectStatus> {
    const athlete = await this.requireAthlete(athleteId);

    return connectStatus(athlete);
  }

  private async requireAthlete(athleteId: AthleteId): Promise<AthleteRow> {
    const athlete = await this.athletes.findById(athleteId);

    if (!athlete) {
      this.logger.warn(`Athlete ${athleteId} not found`);

      throw new NotFoundError('athlete_not_found');
    }

    return athlete;
  }

  private async loadEligibleAthlete(athleteId: AthleteId): Promise<AthleteRow> {
    const athlete = await this.requireAthlete(athleteId);

    if (athlete.isBanned) {
      this.logger.warn(`Athlete ${athleteId} is banned and cannot start Connect onboarding`);

      throw new ForbiddenError('athlete_banned');
    }

    if (!athlete.isAdult) {
      this.logger.warn(`Athlete ${athleteId} is not an attested adult and cannot start Connect onboarding`);

      throw new ForbiddenError('athlete_not_adult');
    }

    return athlete;
  }

  private async provisionAccount(athlete: AthleteRow): Promise<StripeConnectAccountId> {
    const snapshot = await this.gateway.createExpressAccount({
      athleteId: athlete.id,
      email: normalizeEmail(athlete.email),
    });
    const stored = await this.athletes.setStripeConnectAccountIdIfUnset(athlete.id, snapshot.id);

    if (stored?.stripeConnectAccountId != null) {
      return stored.stripeConnectAccountId;
    }

    return this.storedAccountIdAfterLostRace(athlete.id, snapshot.id);
  }

  private async storedAccountIdAfterLostRace(
    athleteId: AthleteId,
    createdAccountId: StripeConnectAccountId,
  ): Promise<StripeConnectAccountId> {
    const current = await this.requireAthlete(athleteId);

    if (current.stripeConnectAccountId == null) {
      this.logger.error(`Connect account ${createdAccountId} could not be stored for athlete ${athleteId}`);

      throw new ConflictError('connect_account_conflict');
    }

    if (current.stripeConnectAccountId !== createdAccountId) {
      this.logger.error(
        `[connect_account_orphaned] Athlete ${athleteId} lost the Connect account race: using ${current.stripeConnectAccountId}, ${createdAccountId} is orphaned`,
      );
    }

    return current.stripeConnectAccountId;
  }
}
