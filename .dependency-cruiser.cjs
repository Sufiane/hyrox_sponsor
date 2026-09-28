module.exports = {
  forbidden: [
    {
      name: 'no-orm-outside-db-layer',
      comment:
        'Only *.db.ts files may import the Prisma client. *.service.ts and *.usecase.ts must stay ORM-free. src/prisma/ is the PrismaClient wrapper and is the ORM boundary itself.',
      severity: 'error',
      from: {
        path: '^src/.+\\.(service|usecase)\\.ts$',
        pathNot: '^src/prisma/',
      },
      to: {
        path: 'node_modules/@prisma/client',
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
