# syntax=docker/dockerfile:1
FROM node:22 AS base

ARG TARGETARCH

RUN apt-get update && \
  apt-get install -y --no-install-recommends curl ca-certificates && \
  rm -rf /var/lib/apt/lists/*

# ffmpeg (usado pelo fluent-ffmpeg, pelo yt-dlp para juntar/converter mídia e
# pelo serviço de mídia do bot)
RUN apt-get update && \
  apt-get install -y --no-install-recommends ffmpeg && \
  rm -rf /var/lib/apt/lists/*

# yt-dlp: binário standalone oficial (não precisa de Python instalado).
# Roda no Debian bookworm (glibc 2.36 >= 2.17 exigido pelo binário).
# O mp3/merge usa o ffmpeg instalado acima.
RUN case "$TARGETARCH" in \
      arm64) asset="yt-dlp_linux_aarch64" ;; \
      arm) asset="yt-dlp_linux_armv7" ;; \
      *) asset="yt-dlp_linux" ;; \
    esac \
  && curl -fsSL --retry 3 -o /usr/local/bin/yt-dlp \
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}" \
  && chmod +x /usr/local/bin/yt-dlp \
  && yt-dlp --version

ENV NODE_ENV=production

WORKDIR /opt/project

# Instalações e build
# O scripts/ precisa vir antes do npm ci: o postinstall roda
# scripts/patch-baileys.mjs (que aplica os patches do Baileys).
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev

# Código
COPY . .

# Permissões para scripts shell (o host Remove o bit executável em uploads)
RUN chmod +x update.sh reset-qr-auth.sh 2>/dev/null || true

# O servidor de pareamento escuta em process.env.PORT (o Render injeta a porta
# dele; 10000 é o padrão do Render e também o padrão local da imagem).
ENV PORT=10000
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "const port=process.env.PORT||3000;require('node:http').get('http://127.0.0.1:'+port+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "start"]
