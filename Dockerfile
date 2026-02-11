# Deploy completa para Render (Híbrido: Node + Python + FFmpeg)
FROM node:22-slim

# Instalar dependências do sistema: Python3, Pip, FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Configurar ambiente virtual Python para yt-dlp (evita erros de externally-managed-environment)
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Instalar yt-dlp e yt-dlp-ejs no ambiente virtual
RUN pip install --no-cache-dir -U "yt-dlp[default]" yt-dlp-ejs

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências Node.js
RUN npm ci --only=production

# Copiar aplicação
COPY . .

# Expor porta
EXPOSE 3000

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Health check (adaptado para ESM)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "import('http').then(h => h.get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }))"

# Iniciar servidor
CMD ["npm", "start"]
