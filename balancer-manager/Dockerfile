FROM node:18-alpine

# Docker CLI ve netcat kurulumu
RUN apk add --no-cache docker-cli netcat-openbsd

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Docker grubu oluştur ve nodejs kullanıcısını ekle
RUN addgroup -S docker && \
    adduser -S nodejs -G docker

# Başlangıç scripti oluştur
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'if [ -e /var/run/docker.sock ]; then' >> /entrypoint.sh && \
    echo '    chmod 660 /var/run/docker.sock' >> /entrypoint.sh && \
    echo 'fi' >> /entrypoint.sh && \
    echo 'exec node index.js' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

USER nodejs

ENTRYPOINT ["/entrypoint.sh"] 