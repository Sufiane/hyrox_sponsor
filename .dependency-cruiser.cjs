module.exports = {
  forbidden: [
    {
      name: 'no-orm-outside-db-layer',
      comment:
        'Only *.db.ts files may import the Prisma client. *.service.ts and *.usecase.ts must stay ORM-free. src/prisma/prisma.service.ts is the PrismaClient wrapper and is the ORM boundary itself.',
      severity: 'error',
      from: {
        path: '^src/.+\\.(service|usecase)\\.ts$',
        pathNot: '^src/prisma/prisma\\.service\\.ts$',
      },
      to: {
        path: 'node_modules/@prisma/client',
      },
    },
    {
      name: 'no-prisma-service-outside-db-layer',
      comment:
        '*.service.ts and *.usecase.ts must not import anything under src/prisma/ (PrismaService is only for *.db.ts files and modules).',
      severity: 'error',
      from: {
        path: '^src/.+\\.(service|usecase)\\.ts$',
        pathNot: '^src/prisma/',
      },
      to: {
        path: '^src/prisma/',
      },
    },
    {
      name: 'no-aws-sdk-outside-storage-adapter',
      comment: 'Only the S3 adapter may import the AWS SDK; everything else uses the DocumentStorage port.',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: '^src/storage/s3-document-storage\\.ts$',
      },
      to: {
        path: 'node_modules/@aws-sdk',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
};
