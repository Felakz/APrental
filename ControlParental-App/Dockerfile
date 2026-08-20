FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/ .
COPY agente/ ./agente/
RUN mkdir -p data/pdfs

EXPOSE 4000

CMD ["node", "server.js"]
