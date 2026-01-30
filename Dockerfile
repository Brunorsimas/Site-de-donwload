# Deploy direto no Render - Versão robusta
FROM node:18-slim

# Instalar curl e ffmpeg
RUN apt-get update && apt-get install -y curl ffmpeg wget && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Limpar cache e instalar dependências
RUN npm cache clean --force && npm install --production --no-optional

# Copiar aplicação
COPY . .

# Tornar yt-dlp executável (se existir)
RUN if [ -f "yt-dlp" ]; then chmod +x yt-dlp; fi

# Expor porta
EXPOSE 3000

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Health check melhorado
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Iniciar com timeout para evitar hangs
CMD ["sh", "-c", "timeout 300s npm start || exit 1"]
