const express = require('express');
const ytdl = require('@distube/ytdl-core');
const path = require('path');

// Configuration pour éviter les erreurs de mise à jour
process.env.YTDL_NO_UPDATE = 'true';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour servir les fichiers statiques
app.use(express.static(path.join(__dirname)));

// Route principale - servir index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route de téléchargement
app.get('/download', async (req, res) => {
    try {
        const url = req.query.url;
        
        if (!url) {
            return res.status(400).send('URL manquante. Veuillez fournir une URL YouTube valide.');
        }

        // Validation de l'URL YouTube
        if (!ytdl.validateURL(url)) {
            return res.status(400).send('URL YouTube invalide. Veuillez vérifier l\'URL et réessayer.');
        }

        console.log(`Début du téléchargement pour: ${url}`);

        // Obtenir les informations de la vidéo avec retry
        let info;
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
            try {
                info = await ytdl.getInfo(url);
                break;
            } catch (error) {
                retryCount++;
                if (retryCount >= maxRetries) {
                    throw error;
                }
                console.log(`Tentative ${retryCount} échouée, nouvelle tentative...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            }
        }
        
        const title = info.videoDetails.title.replace(/[^\w\s-]/gi, '').substring(0, 50);
        
        // Configuration des headers pour le téléchargement
        res.setHeader('Content-Disposition', `attachment; filename="${title || 'video'}.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');
        
        // Options améliorées pour ytdl-core
        const options = {
            quality: 'highestvideo',
            filter: format => format.hasVideo && format.hasAudio && format.container === 'mp4',
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }
        };

        // Si pas de format avec vidéo+audio, prendre le meilleur format disponible
        const formats = ytdl.filterFormats(info.formats, 'videoandaudio');
        if (formats.length === 0) {
            options.quality = 'highest';
            delete options.filter;
        }

        // Créer le stream de téléchargement
        const videoStream = ytdl(url, options);
        
        // Gestion des erreurs du stream
        videoStream.on('error', (error) => {
            console.error('Erreur du stream vidéo:', error);
            if (!res.headersSent) {
                res.status(500).send(`Erreur lors du streaming: ${error.message}`);
            }
        });

        // Gestion du début du stream
        videoStream.on('response', (response) => {
            console.log('Stream démarré, taille:', response.headers['content-length']);
        });

        // Gestion de la progression
        videoStream.on('progress', (chunkLength, downloaded, total) => {
            const percent = (downloaded / total * 100).toFixed(2);
            console.log(`Progression: ${percent}%`);
        });

        // Pipe du stream vers la réponse
        videoStream.pipe(res);

        // Gestion de la fin du téléchargement
        videoStream.on('end', () => {
            console.log('Téléchargement terminé avec succès');
        });

        // Gestion de la fermeture de la connexion client
        req.on('close', () => {
            console.log('Connexion fermée par le client');
            if (videoStream && !videoStream.destroyed) {
                videoStream.destroy();
            }
        });

    } catch (error) {
        console.error('Erreur lors du téléchargement:', error);
        
        if (!res.headersSent) {
            if (error.message.includes('Video unavailable') || error.statusCode === 410) {
                res.status(404).send('Vidéo non disponible. Elle pourrait être privée, supprimée, géo-bloquée ou temporairement inaccessible.');
            } else if (error.message.includes('age-restricted')) {
                res.status(403).send('Cette vidéo a une restriction d\'âge et ne peut pas être téléchargée.');
            } else if (error.statusCode === 403) {
                res.status(403).send('Accès refusé. La vidéo pourrait avoir des restrictions de téléchargement.');
            } else {
                res.status(500).send(`Erreur lors du téléchargement: ${error.message}`);
            }
        }
    }
});

// Route de santé pour Render
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Middleware de gestion d'erreur globale
app.use((error, req, res, next) => {
    console.error('Erreur non gérée:', error);
    res.status(500).send('Erreur interne du serveur');
});

// Middleware pour les routes non trouvées
app.use((req, res) => {
    res.status(404).send('Page non trouvée');
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    console.log(`📱 Application disponible sur: http://localhost:${PORT}`);
    console.log(`🎥 Prêt à télécharger des vidéos YouTube !`);
});

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
    console.log('Signal SIGTERM reçu, arrêt du serveur...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Signal SIGINT reçu, arrêt du serveur...');
    process.exit(0);
});
