const { PrismaClient } = require('@prisma/client');
const env = require('./env');

const prismaOptions = {
  log:
    env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
};

// Singleton pattern to avoid multiple instances in development (hot-reload)
const globalForPrisma = global;

const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaOptions);

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Gracefully disconnect Prisma on shutdown.
 */
async function disconnectDatabase() {
  await prisma.$disconnect();
}

module.exports = { prisma, disconnectDatabase };