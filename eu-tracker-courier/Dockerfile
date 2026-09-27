# Imagen de producción de EU TRACKER COURIER.
FROM node:22-alpine

RUN apk add --no-cache openssl

EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN npx prisma generate && npm run build

# `docker-start` aplica las migraciones pendientes y arranca el servidor.
CMD ["npm", "run", "docker-start"]
