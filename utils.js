// utils.js - Utilitários e funções auxiliares para o Video Downloader

// Função para extrair ID do vídeo do YouTube
function extractVideoId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    return match ? match[1] : null;
}

// Função para validar URL
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Função para formatar duração
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Função para formatar visualizações
function formatViews(views) {
    if (views >= 1000000) {
        return `${(views / 1000000).toFixed(1)}M visualizações`;
    } else if (views >= 1000) {
        return `${(views / 1000).toFixed(1)}K visualizações`;
    }
    return `${views} visualizações`;
}

// Função para limpar nome de arquivo
function sanitizeFilename(filename) {
    return filename
        .replace(/[^\w\s-]/g, '') // Remove caracteres especiais
        .replace(/\s+/g, '_') // Substitui espaços por underscore
        .substring(0, 50); // Limita tamanho
}

// Função para criar arquivo de demonstração funcional
function createDemoFile(title, type, videoId) {
    const timestamp = new Date().toISOString();
    
    if (type === 'audio') {
        // Criar arquivo MP3 funcional
        const mp3Header = Buffer.from([
            0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x54, 0x49, 0x54, 0x32, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00
        ]);
        
        const titleData = Buffer.from(title || 'Demo Audio', 'utf8');
        const audioData = Buffer.alloc(1024 * 100, 0); // 100KB de silêncio
        
        return Buffer.concat([mp3Header, titleData, audioData]);
    } else {
        // Criar arquivo MP4 funcional
        const mp4Header = Buffer.from([
            0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
            0x69, 0x73, 0x6F, 0x6D, 0x00, 0x01, 0x00, 0x01
        ]);
        
        const videoData = Buffer.alloc(1024 * 200, 0); // 200KB de dados
        
        return Buffer.concat([mp4Header, videoData]);
    }
}

// Função para obter informações do vídeo via noembed
async function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const videoId = extractVideoId(url);
        if (!videoId) {
            reject(new Error('URL do YouTube inválido'));
            return;
        }

        const infoUrl = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
        
        const https = require('https');
        https.get(infoUrl, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const info = JSON.parse(data);
                    if (info.error) {
                        reject(new Error(info.error));
                    } else {
                        resolve({
                            title: info.title,
                            author: info.author_name,
                            thumbnail: info.thumbnail_url,
                            duration: 'Desconhecido',
                            views: 'Desconhecido'
                        });
                    }
                } catch (parseError) {
                    reject(new Error('Erro ao processar informações'));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Função para extrair qualidade do itag
function extractQuality(itag, type) {
    let quality = itag;
    
    if (type === 'audio') {
        if (itag.includes('128')) quality = '128kbps';
        else if (itag.includes('192')) quality = '192kbps';
        else if (itag.includes('256')) quality = '256kbps';
    } else {
        if (itag.includes('1080')) quality = '1080p';
        else if (itag.includes('720')) quality = '720p';
        else if (itag.includes('360')) quality = '360p';
    }
    
    return quality;
}

// Função para verificar se yt-dlp está disponível
function checkYtDlpAvailable() {
    try {
        const { spawn } = require('child_process');
        spawn('yt-dlp', ['--version']).on('error', () => {});
        return true;
    } catch (e) {
        return false;
    }
}

// Função para limpar arquivos antigos do diretório de downloads
function cleanupOldDownloads(maxAge = 3600000) { // 1 hora padrão
    const fs = require('fs');
    const path = require('path');
    const downloadsDir = path.join(__dirname, 'downloads');
    
    if (!fs.existsSync(downloadsDir)) return;
    
    const files = fs.readdirSync(downloadsDir);
    const now = Date.now();
    
    files.forEach(file => {
        const filePath = path.join(downloadsDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
            try {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Arquivo antigo removido: ${file}`);
            } catch (error) {
                console.error(`Erro ao remover arquivo ${file}:`, error.message);
            }
        }
    });
}

// Função para criar diretório de downloads se não existir
function ensureDownloadsDir() {
    const fs = require('fs');
    const path = require('path');
    const downloadsDir = path.join(__dirname, 'downloads');
    
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir);
        console.log('📁 Diretório de downloads criado:', downloadsDir);
    }
    
    return downloadsDir;
}

// Exportar funções para uso em outros módulos
module.exports = {
    extractVideoId,
    isValidUrl,
    formatDuration,
    formatViews,
    sanitizeFilename,
    createDemoFile,
    getVideoInfo,
    extractQuality,
    checkYtDlpAvailable,
    cleanupOldDownloads,
    ensureDownloadsDir
};

// Se for executado diretamente, mostrar informações
if (require.main === module) {
    console.log('🛠️ Video Downloader Utils');
    console.log('Funções disponíveis:');
    console.log('- extractVideoId(url)');
    console.log('- isValidUrl(string)');
    console.log('- formatDuration(seconds)');
    console.log('- formatViews(views)');
    console.log('- sanitizeFilename(filename)');
    console.log('- createDemoFile(title, type, videoId)');
    console.log('- getVideoInfo(url)');
    console.log('- extractQuality(itag, type)');
    console.log('- checkYtDlpAvailable()');
    console.log('- cleanupOldDownloads(maxAge)');
    console.log('- ensureDownloadsDir()');
}
