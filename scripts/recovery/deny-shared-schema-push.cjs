// No env loading, DB connection or Prisma invocation.
console.error('SHARED_SCHEMA_DDL_BLOCKED: schema.prisma includes Mastra client models. Use only a reviewed Prisma-owned migration chain; db push/reset cannot safely manage this shared schema.');
process.exitCode = 78;
