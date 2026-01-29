# Use Ubuntu como base (melhor compatibilidade)
FROM node:18-slim

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp separadamente para melhor debug
RUN pip3 install --no-cache-dir yt-dlp

# Verificar instalação
RUN python3 -c "import yt_dlp; print('yt-dlp installed successfully')" \
    && ffmpeg -version

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de configuração primeiro
COPY package*.json ./

# Instalar dependências Node.js
RUN npm install --production && npm cache clean --force

# Copiar código da aplicação
COPY . .

# Criar diretório de downloads
RUN mkdir -p downloads && chmod 755 downloads

# Expor porta
EXPOSE 3000

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Health check simplificado
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Iniciar aplicação
CMD ["npm", "start"]
