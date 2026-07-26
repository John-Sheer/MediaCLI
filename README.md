# MediaCLI

Application de bureau pour la recherche, l'écoute et le téléchargement de musique depuis YouTube.

## Utilisation

1. Extrayez le dossier **MediaCLI_Portable** depuis le fichier ZIP
2. Lancez **MediaCLI.exe**
3. Saisissez le nom d'un titre ou d'un artiste dans la barre de recherche, puis appuyez sur **Entrée**
4. Cliquez sur **Play** (▶) pour écouter un extrait, ou sur **⬇ MP3** / **⬇ MP4** pour télécharger

## Compatibilité

| Plateforme | Statut |
|-----------|--------|
| **Windows 11** | ✅ Compatible |
| **Windows 10** | ✅ Compatible |
| **Windows 7 / 8** | ⚠️ Partiel |
| **Linux** | 🚧 En développement |
| **macOS** | 🚧 En développement |

> **Note Windows 7/8** : l'installation manuelle du [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) peut être nécessaire.

## Déploiement

Il suffit d'extraire le ZIP et de lancer **MediaCLI.exe**. Aucune installation requise.

```
MediaCLI_Portable/
├── MediaCLI.exe
├── mediacli-server.exe
└── resources/
```

## Dépannage

- **Aucun son** : vérifiez le mélangeur de volume Windows (clic droit sur l'icône du haut-parleur dans la barre des tâches)
- **La recherche ne retourne rien** : vérifiez votre connexion internet
- **Protection de la vie privée** : cliquez sur **WARP** dans l'application pour télécharger Cloudflare WARP (gratuit, rapide, fiable). Le bouton **Tor** est disponible en alternative si nécessaire.
- **Windows 7 / 8** : installez [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) si l'application ne se lance pas
