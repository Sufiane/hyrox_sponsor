import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://hyrox:hyrox@localhost:5435/postgres';

export type ThrowawayDatabase = { prisma: PrismaService; drop: () => Promise<void> };

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);

  url.pathname = `/${name}`;
  url.searchParams.set('connection_limit', '20');

  return url.toString();
}

export async function isPostgresReachable(adminUrl: string): Promise<boolean> {
  const admin = new PrismaClient({ datasourceUrl: adminUrl });

  try {
    await admin.$queryRaw`SELECT 1`;

    return true;
  } catch {
    return false;
  } finally {
    await admin.$disconnect();
  }
}

function restoreDatabaseUrl(previousUrl: string | undefined): void {
  if (previousUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousUrl;
  }
}

export async function createThrowawayDatabase(adminUrl: string): Promise<ThrowawayDatabase> {
  const name = `hyrox_it_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  const previousUrl = process.env.DATABASE_URL;
  let prisma: PrismaService | null = null;

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } catch (error) {
    await admin.$disconnect();

    throw error;
  }

  try {
    const url = databaseUrl(adminUrl, name);

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });

    process.env.DATABASE_URL = url;
    prisma = new PrismaService();

    await prisma.onModuleInit();
  } catch (error) {
    await prisma?.onModuleDestroy();
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.$disconnect();
    restoreDatabaseUrl(previousUrl);

    throw error;
  }

  const connected = prisma;

  return {
    prisma: connected,
    drop: async (): Promise<void> => {
      await connected.onModuleDestroy();
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      restoreDatabaseUrl(previousUrl);
    },
  };
}
