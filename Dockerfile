# Deploy direto no Render (sem Docker real)
FROM node:18-slim

# Instalar curl para baixar yt-dlp
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências e yt-dlp
RUN npm install --production

# Copiar aplicação
COPY . .

# Expor porta
EXPOSE 3000

# Iniciar
CMD ["npm", "start"]
