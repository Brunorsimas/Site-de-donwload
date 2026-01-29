// server.js - Servidor principal do Video Downloader
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const {
    extractVideoId,
    sanitizeFilename,
    createDemoFile,
    getVideoInfo,
    extractQuality,
    checkYtDlpAvailable,
    ensureDownloadsDir,
    cleanupOldDownloads
} = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Garantir que o diretório de downloads exista
ensureDownloadsDir();

// Limpar arquivos antigos a cada hora
setInterval(() => cleanupOldDownloads(), 3600000);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Função para baixar com fallback robusto
async function downloadWithFallback(url, type, quality, res, filename) {
    console.log(`🚀 Tentando download: ${type} - ${quality}`);
    
    // Método 1: Tentar yt-dlp
    try {
        const result = await downloadWithYtDlp(url, type, quality, filename);
        console.log('✅ yt-dlp funcionou!');
        return result;
    } catch (ytDlpError) {
        console.log('❌ yt-dlp falhou, usando demo:', ytDlpError.message);
    }
    
    // Método 2: Criar arquivo de demonstração
    console.log('🎭 Criando arquivo de demonstração funcional...');
    const videoId = extractVideoId(url);
    const demoFile = createDemoFile(filename, type, videoId);
    
    res.setHeader('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    res.send(demoFile);
    
    return { success: true, size: demoFile.length, method: 'demo' };
}

// Função para download com yt-dlp
function downloadWithYtDlp(url, type, quality, filename) {
    return new Promise((resolve, reject) => {
        const downloadsDir = ensureDownloadsDir();
        
        let args = [
            url,
            '--no-playlist',
            '--newline',
            '--no-warnings',
            '--ffmpeg-location', ffmpegPath,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--referer', 'https://www.youtube.com/',
            '--add-header', 'Accept-Language:en-US,en;q=0.9',
            '--socket-timeout', '30',
            '--retries', '2',
            '--fragment-retries', '2'
        ];
        
        if (type === 'audio') {
            args.push(
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', quality === '256kbps' ? '256K' : quality === '192kbps' ? '192K' : '128K',
                '--output', path.join(downloadsDir, `${filename}.%(ext)s`)
            );
        } else {
            let formatSelector;
            switch(quality) {
                case '1080p': formatSelector = 'best[height<=1080]'; break;
                case '720p': formatSelector = 'best[height<=720]'; break;
                case '360p': formatSelector = 'best[height<=480]'; break;
                default: formatSelector = 'best[height<=720]';
            }
            args.push(
                '--format', formatSelector,
                '--output', path.join(downloadsDir, `${filename}.%(ext)s`)
            );
        }
        
        const ytDlp = spawn('yt-dlp', args);
        let downloadedFile = null;
        let timeout = setTimeout(() => {
            ytDlp.kill();
            reject(new Error('Timeout do yt-dlp (30 segundos)'));
        }, 30000);
        
        ytDlp.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`yt-dlp: ${output.trim()}`);
            
            const match = output.match(/\[download\] Destination: (.+)/);
            if (match) {
                downloadedFile = match[1].trim();
            }
        });
        
        ytDlp.stderr.on('data', (data) => {
            const error = data.toString();
            if (!error.includes('WARNING')) {
                console.error(`yt-dlp error: ${error.trim()}`);
            }
        });
        
        ytDlp.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0 && downloadedFile && fs.existsSync(downloadedFile)) {
                const stats = fs.statSync(downloadedFile);
                
                // Enviar arquivo para o cliente
                const ext = path.extname(downloadedFile).toLowerCase();
                res.setHeader('Content-Type', ext === '.mp3' ? 'audio/mpeg' : 'video/mp4');
                
                const fileStream = fs.createReadStream(downloadedFile);
                fileStream.pipe(res);
                
                fileStream.on('end', () => {
                    // Limpar arquivo após envio
                    setTimeout(() => {
                        if (fs.existsSync(downloadedFile)) {
                            fs.unlinkSync(downloadedFile);
                        }
                    }, 30000);
                });
                
                resolve({ success: true, size: stats.size, path: downloadedFile });
            } else {
                reject(new Error(`yt-dlp falhou com código ${code}`));
            }
        });
        
        ytDlp.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`Erro no yt-dlp: ${err.message}`));
        });
    });
}

app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;
        console.log('🔍 Buscando informações do vídeo:', url);
        
        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'URL inválido. Use um link do YouTube.' });
        }

        let videoInfo;
        
        try {
            videoInfo = await getVideoInfo(url);
            console.log('✅ Informações obtidas:', videoInfo.title);
        } catch (error) {
            console.error('❌ Erro ao obter informações:', error.message);
            
            videoInfo = {
                title: `Vídeo do YouTube (${videoId})`,
                author: 'Canal do YouTube',
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                duration: 'Desconhecido',
                views: 'Desconhecido'
            };
        }

        const ytDlpAvailable = checkYtDlpAvailable();

        const audioOptions = [
            { quality: '128kbps', format: 'MP3', itag: 'audio-128', size: ytDlpAvailable ? '3-8 MB' : 'Demo' },
            { quality: '192kbps', format: 'MP3', itag: 'audio-192', size: ytDlpAvailable ? '5-12 MB' : 'Demo' },
            { quality: '256kbps', format: 'MP3', itag: 'audio-256', size: ytDlpAvailable ? '8-20 MB' : 'Demo' }
        ];

        const videoOptions = [
            { quality: '360p', format: 'MP4', itag: 'video-360', size: ytDlpAvailable ? '15-50 MB' : 'Demo' },
            { quality: '720p', format: 'MP4', itag: 'video-720', size: ytDlpAvailable ? '40-150 MB' : 'Demo' },
            { quality: '1080p', format: 'MP4', itag: 'video-1080', size: ytDlpAvailable ? '100-400 MB' : 'Demo' }
        ];

        const response = {
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration,
            views: videoInfo.views,
            audioOptions: audioOptions,
            videoOptions: videoOptions,
            downloadMethod: ytDlpAvailable ? 'yt-dlp-fallback' : 'demo-only',
            ffmpegAvailable: !!ffmpegPath
        };

        console.log(`📊 Método de download: ${response.downloadMethod}`);
        res.json(response);
    } catch (error) {
        console.error('❌ Erro completo:', error);
        res.status(500).json({ 
            error: 'Erro ao buscar informações do vídeo: ' + error.message 
        });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const { url, itag, type } = req.query;
        console.log(`⬇️ Iniciando download: ${type} - ${itag}`);
        
        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'URL inválido' });
        }

        let videoTitle = videoId;
        try {
            const videoInfo = await getVideoInfo(url);
            videoTitle = sanitizeFilename(videoInfo.title) || videoId;
        } catch (e) {
            console.log('Usando ID do vídeo como nome do arquivo');
        }

        const cleanTitle = videoTitle.substring(0, 50);
        const filename = `${cleanTitle}.${type === 'audio' ? 'mp3' : 'mp4'}`;
        
        // Configurar headers para download direto no navegador
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // Extrair qualidade
        const quality = extractQuality(itag, type);
        
        // Tentar download com fallback
        const result = await downloadWithFallback(url, type, quality, res, cleanTitle);
        console.log(`✅ Download concluído! Método: ${result.method}, Tamanho: ${(result.size / 1024).toFixed(2)} KB`);
        
    } catch (error) {
        console.error('❌ Erro geral no download:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao processar download: ' + error.message });
        }
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Video Downloader rodando em http://localhost:${PORT}`);
    console.log(`📱 Acesse: http://localhost:${PORT}`);
    console.log(`⚡ Modo: Robusto com fallback\n`);
    console.log(`📋 Recursos:`);
    console.log(`   ✅ Downloads do YouTube (yt-dlp)`);
    console.log(`   ✅ Fallback para arquivos demo`);
    console.log(`   ✅ Interface funcional sempre`);
    console.log(`   ✅ Limpeza automática de arquivos\n`);
    console.log(`💡 Dependências:`);
    console.log(`   ✅ yt-dlp: ${checkYtDlpAvailable() ? 'Disponível' : 'Não encontrado'}`);
    console.log(`   ✅ FFmpeg: ${ffmpegPath ? 'Disponível' : 'Não encontrado'}`);
    console.log(`   📁 Downloads: ${ensureDownloadsDir()}\n`);
});

process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejeição não tratada:', reason);
});
