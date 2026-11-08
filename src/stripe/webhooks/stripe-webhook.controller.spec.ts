import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvalidValueError } from '../../common/domain-error';
import { DomainErrorFilter } from '../../common/domain-error.filter';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: Record<string, unknown>): Record<string, unknown> {
    return body;
  }
}

describe('StripeWebhookController', () => {
  const payload = '{"id":"evt_1",  "type":"account.updated"}';
  let app: INestApplication;
  let baseUrl: string;
  let receive: ReturnType<typeof vi.fn>;

  function post(path: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });
  }

  beforeEach(async () => {
    receive = vi.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [StripeWebhookController, EchoController],
      providers: [{ provide: StripeWebhookService, useValue: { receive } }],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new DomainErrorFilter());
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterEach(async () => {
    await app.close();
  });

  describe.each([
    ['/stripe/webhooks/platform', 'platform'],
    ['/stripe/webhooks/connect', 'connect'],
  ])('when posting to %s', (path, channel) => {
    it('responds 200 with an empty body', async () => {
      const response = await post(path, payload, { 'Stripe-Signature': 't=1,v1=abc' });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    });

    it('passes the untouched raw bytes, signature and route channel to the service', async () => {
      await post(path, payload, { 'Stripe-Signature': 't=1,v1=abc' });

      const input = receive.mock.calls[0][0] as { rawBody: Buffer; signature: string; channel: string };

      expect(Buffer.isBuffer(input.rawBody)).toBe(true);
      expect(input.rawBody.toString('utf8')).toBe(payload);
      expect(input.signature).toBe('t=1,v1=abc');
      expect(input.channel).toBe(channel);
    });

    it('ignores a channel supplied in the query, headers or body', async () => {
      const other = channel === 'platform' ? 'connect' : 'platform';

      await post(`${path}?channel=${other}`, JSON.stringify({ channel: other }), {
        'Stripe-Signature': 'sig',
        'X-Channel': other,
      });

      expect((receive.mock.calls[0][0] as { channel: string }).channel).toBe(channel);
    });

    it('maps stripe_signature_invalid to 400', async () => {
      receive.mockRejectedValue(new InvalidValueError('stripe_signature_invalid'));

      const response = await post(path, payload);

      expect(response.status).toBe(400);
      expect(((await response.json()) as { message: string }).message).toBe('stripe_signature_invalid');
    });
  });

  describe('when rawBody is enabled and another route receives JSON', () => {
    it('still parses the body as JSON', async () => {
      const response = await post('/echo', JSON.stringify({ hello: 'world', nested: { count: 2 } }));

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ hello: 'world', nested: { count: 2 } });
    });
  });
});
