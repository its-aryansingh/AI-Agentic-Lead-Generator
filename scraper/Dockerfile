FROM mcr.microsoft.com/playwright:v1.48.0-jammy
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

EXPOSE 8080
CMD ["node", "dist/server.js"]
