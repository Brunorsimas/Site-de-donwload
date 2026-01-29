# Deploy direto no Render (sem Docker real)
FROM node:18-slim

# Instalar curl e ffmpeg
RUN apt-get update && apt-get install -y curl ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Limpar cache e instalar dependências
RUN npm cache clean --force && npm install --production --no-optional

# Copiar aplicação
COPY . .

# Expor porta
EXPOSE 3000

# Iniciar
CMD ["npm", "start"]
