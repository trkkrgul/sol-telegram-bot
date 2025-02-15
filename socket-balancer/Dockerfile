FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Healthcheck için netcat kur
RUN apk add --no-cache netcat-openbsd

# RabbitMQ bağlantısını bekle
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
    CMD nc -z rabbitmq 5672

CMD ["node", "index.js"] 