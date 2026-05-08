const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcrypt')

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10)

  await prisma.user.create({
    data: {
      email: 'admin@circlesave.com',
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
    },
  })

  console.log('✅ Admin created')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())