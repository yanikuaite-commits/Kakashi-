# syntax=docker/dockerfile:1
FROM node:22 AS base

RUN apt-get update && \
  apt-get install -y --no-install-recommends curl ca-certificates && \
  rm -rf /var/lib/apt/lists/*

# ffmpeg (usado pelo fluent-ffmpeg e pelo serviço de mídia do bot)
RUN apt-get update && \
  apt-get install -y --no-install-recommends ffmpeg && \
  rm -rf /var/lib/apt/lists/*

# yt-dlp standalone para Linux x64 (executável único, sem .deb)
ARG YT_DLP_VERSION=2026.08.19
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux" -o /usr/local/bin/yt-dlp && \
  chmod +x /usr/local/bin/yt-dlp && \
  yt-dlp --version

ENV NODE_ENV=production

WORKDIR /opt/project

# Instalações e build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código
COPY . .

# Permissões para scripts shell (o host Remove o bit executável em uploads)
RUN chmod +x update.sh reset-qr-auth.sh 2>/dev/null || true

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('node:http').get('http://localhost:8080/', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
