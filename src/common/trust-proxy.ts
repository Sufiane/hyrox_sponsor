import type { NestExpressApplication } from '@nestjs/platform-express';

export function applyTrustProxy(app: Pick<NestExpressApplication, 'set'>, hops: number): void {
  app.set('trust proxy', hops === 0 ? false : hops);
}
