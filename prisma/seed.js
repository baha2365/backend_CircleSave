const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Admin123!', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@circlesave.com' },
    update: {},
    create: {
      email: 'admin@circlesave.com',
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      isVerified: true,
      isActive: true,
      trustScore: 100,
    },
  });

  console.log('✅ Admin created:', admin.email, '| role:', admin.role);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());