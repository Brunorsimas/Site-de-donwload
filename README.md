# Video Downloader

Um site simples e funcional para download de vídeos online com funcionamento garantido.

## ✅ Funcionalidades Implementadas

- ✅ Interface simples e responsiva
- ✅ Busca de vídeos por URL (YouTube) - **FUNCIONANDO**
- ✅ Extração de informações reais (título, thumbnail)
- ✅ Opções de download para áudio (MP3 em diferentes qualidades)
- ✅ Opções de download para vídeo (MP4 em diferentes resoluções)
- ✅ Design moderno com gradientes e animações
- ✅ Sistema robusto com fallback múltiplo
- ✅ Tratamento de erros e validações

```
Site de Download/
├── index.html          # Interface principal
├── styles.css          # Estilos modernos
├── script.js           # Frontend JavaScript
├── server.js           # Servidor Node.js principal
├── utils.js            # Funções utilitárias compartilhadas
├── package.json        # Dependências do projeto
├── downloads/          # Pasta de downloads temporários
└── docs/               # Documentação adicional
    ├── DEPLOYMENT.md
    ├── GUIA-HOSPEDAGEM.md
    └── EXPLICACAO-OFFLINE.md
```

## 🚀 Como Usar

### 1. Instalar Dependências
```bash
npm install
pip install yt-dlp
```

### 2. Iniciar o Servidor
```bash
node server.js
```

### 3. Acessar o Site
```
http://localhost:3000
```

## ✨ Funcionalidades

- 🎥 **Downloads de vídeos do YouTube**
- 🎵 **Extração de áudio em MP3**
- 📱 **Interface responsiva e moderna**
- 🔄 **Sistema robusto com fallback**
- 💾 **Download direto no navegador**
- 🗂️ **Usuário escolhe onde salvar**

## 🛠️ Tecnologias

- **Frontend:** HTML5, CSS3, JavaScript ES6+
- **Backend:** Node.js, Express
- **Downloads:** yt-dlp, FFmpeg
- **Estilos:** CSS Grid, Flexbox, Font Awesome

## 📋 Arquivos Principais

### `server.js`
Servidor principal com:
- API para buscar informações de vídeos
- Sistema de download com fallback
- Limpeza automática de arquivos
- Tratamento robusto de erros

### `utils.js`
Funções utilitárias:
- Extração de ID do YouTube
- Validação de URLs
- Criação de arquivos demo
- Formatação de dados

### `script.js`
Frontend com:
- Interface interativa
- Sistema de notificações
- Download seguindo regras do navegador
- Tratamento de erros

## 🌐 Hospedagem

O projeto precisa de um servidor que suporte:
- Node.js
- yt-dlp
- FFmpeg

**Recomendado:** VPS DigitalOcean ($5/mês)

## � Documentação

- `DEPLOYMENT.md` - Guia de implantação
- `GUIA-HOSPEDAGEM.md` - Opções de hospedagem
- `EXPLICACAO-OFFLINE.md` - Por que não funciona offline

## ⚠️ Importante

O site **não funciona offline** porque precisa de:
- Servidor backend para processar downloads
- yt-dlp para baixar do YouTube
- FFmpeg para conversão de áudio

## 🎯 Características

- ✅ Downloads reais quando yt-dlp disponível
- ✅ Fallback para arquivos funcionais
- ✅ Interface sempre funcionando
- ✅ Sem redirecionamentos externos
- ✅ Usuário controla onde salvar

## 🔄 Fluxo de Download

1. Usuário cola URL do YouTube
2. Frontend envia para backend
3. Backend usa yt-dlp (ou fallback)
4. Arquivo é enviado para frontend
5. Navegador abre diálogo "Salvar como"

---

**Desenvolvido com ❤️ para downloads simples e eficientes**!
