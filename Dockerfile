# Deploy simplificado para Render - Sem yt-dlp
FROM node:18-slim

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências
RUN npm cache clean --force && npm install --production --no-optional

# Copiar aplicação
COPY . .

# Expor porta
EXPOSE 3000

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Health check simples
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Iniciar servidor simplificado
CMD ["npm", "start"]
