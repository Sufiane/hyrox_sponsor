import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PasswordHasher } from '../../auth/password-hasher';
import { StaffService } from '../staff.service';
import { runStaffCommand } from './run-staff-command';

const GENERATED_PASSWORD_BYTES = 18;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    process.exitCode = await runStaffCommand(process.argv.slice(2), {
      staffService: app.get(StaffService, { strict: false }),
      hasher: app.get(PasswordHasher, { strict: false }),
      generatePassword: () => randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url'),
      write: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
