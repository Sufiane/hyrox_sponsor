import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { passwordHash, type PasswordHash } from '../common/password-hash';

@Injectable()
export class PasswordHasher implements OnModuleInit {
  private dummyHash!: PasswordHash;

  // Lets login verify against a real hash when the email is unknown, so response time doesn't reveal which emails exist.
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('dummy-password');
  }

  async hash(plain: string): Promise<PasswordHash> {
    const raw = await argon2.hash(plain, { type: argon2.argon2id });

    return passwordHash(raw);
  }

  verify(hash: PasswordHash, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }

  async verifyDummy(plain: string): Promise<void> {
    await this.verify(this.dummyHash, plain);
  }
}
