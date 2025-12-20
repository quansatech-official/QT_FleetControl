FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Puppeteer (Chromium) für PDF
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont

COPY . .
EXPOSE 3000
CMD ["node", "server.js"]