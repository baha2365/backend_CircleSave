FROM node:22-slim

WORKDIR /app

# OpenSSL орнату (MUST for Prisma)
RUN apt-get update -y && apt-get install -y openssl

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

CMD ["node", "src/server.js"]