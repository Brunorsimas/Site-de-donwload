# Use Ubuntu como base (melhor compatibilidade)
FROM node:18-slim

# Instalar dependências do sistema e yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir yt-dlp

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de configuração primeiro
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production && npm cache clean --force

# Copiar código da aplicação
COPY . .

# Criar diretório de downloads
RUN mkdir -p downloads && chmod 755 downloads

# Expor porta
EXPOSE 3000

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Iniciar aplicação
CMD ["npm", "start"]
