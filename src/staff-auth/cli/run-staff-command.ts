import { parseArgs } from 'node:util';
import { assertPasswordLength } from '../../auth/password-policy';
import { PasswordHasher } from '../../auth/password-hasher';
import { DomainError } from '../../common/domain-error';
import { normalizeEmail } from '../../common/email';
import { StaffService } from '../staff.service';

export type StaffCommandDeps = {
  staffService: StaffService;
  hasher: PasswordHasher;
  generatePassword: () => string;
  write: (line: string) => void;
};

type ParsedArgs = { command: string | undefined; email?: string; name?: string; password?: string };

class ArgsInvalidError extends DomainError {
  constructor() {
    super('args_invalid');
  }
}

function parseCommandArgs(argv: string[]): ParsedArgs {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        password: { type: 'string' },
      },
    });

    return { command: positionals[0], email: values.email, name: values.name, password: values.password };
  } catch {
    throw new ArgsInvalidError();
  }
}

async function hashChosenPassword(
  supplied: string | undefined,
  deps: StaffCommandDeps,
): Promise<{ hash: Awaited<ReturnType<PasswordHasher['hash']>>; generated: string | null }> {
  if (supplied !== undefined) {
    assertPasswordLength(supplied);

    return { hash: await deps.hasher.hash(supplied), generated: null };
  }

  const generated = deps.generatePassword();

  return { hash: await deps.hasher.hash(generated), generated };
}

async function execute(args: ParsedArgs, deps: StaffCommandDeps): Promise<void> {
  if (args.email === undefined) {
    throw new ArgsInvalidError();
  }

  const email = normalizeEmail(args.email);

  if (args.command === 'deactivate') {
    if (args.password !== undefined || args.name !== undefined) {
      throw new ArgsInvalidError();
    }

    await deps.staffService.deactivate(email);
    deps.write(`deactivated ${email}`);

    return;
  }

  if (args.command === 'set-password') {
    const chosen = await hashChosenPassword(args.password, deps);

    await deps.staffService.setPassword(email, chosen.hash);
    deps.write(`password updated for ${email}`);

    if (chosen.generated !== null) {
      deps.write(`generated password (shown once): ${chosen.generated}`);
    }

    return;
  }

  if (args.command === 'create') {
    const name = args.name?.trim();

    if (name === undefined || name === '') {
      throw new ArgsInvalidError();
    }

    const chosen = await hashChosenPassword(args.password, deps);

    await deps.staffService.create({ name, email, passwordHash: chosen.hash });
    deps.write(`created ${email}`);

    if (chosen.generated !== null) {
      deps.write(`generated password (shown once): ${chosen.generated}`);
    }

    return;
  }

  throw new ArgsInvalidError();
}

export async function runStaffCommand(argv: string[], deps: StaffCommandDeps): Promise<number> {
  try {
    await execute(parseCommandArgs(argv), deps);

    return 0;
  } catch (error) {
    if (error instanceof DomainError) {
      deps.write(`error: ${error.code}`);

      return 1;
    }

    throw error;
  }
}
