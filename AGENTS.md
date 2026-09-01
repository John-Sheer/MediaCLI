# AGENTS.md — MediaCLI (règles de build & release)

Ce fichier est lu par les agents IA à chaque session. Le respecter évite les
erreurs déjà rencontrées (versions incohérentes, frontend obsolète embarqué,
URLs d'update en cache CDN, assets mal nommés, APK non signé).

## Appareil Android
- Le téléphone cible : `adb -s 2B151FDH3000FC`. Ne jamais utiliser `adb install`
  sans le `-s` (plusieurs appareils peuvent cohabiter).
- Si l'appareil n'est pas listé (câble, autorisation), demander la reconnexion
  avant d'installer. Ne pas installer d'APK « en aveugle ».

## Règle d'orRelease
- NE JAMAIS créer/upload de release GitHub, tag, ou manifest à la main (`gh release
  create`, `gh release upload`, édition de `latest.json`).
- TOUTE publication passe par `release.ps1` (unique point d'entrée). Le script :
  1. refuse de réutiliser un tag existant → URL toujours fraîche → pas de cache CDN
     GitHub qui servirait un vieil APK (cause des bugs « la MAJ tourne en boucle ») ;
  2. bump la version dans package.json, tauri.conf.json, Cargo.toml, Cargo.lock ET
     tauri.properties (versionName + versionCode) automatiquement ;
  3. rebuild front + Windows + `.so` Android + vérifie que le frontend embarqué
     correspond au `dist` actuel (sinon `exit 1`) ;
  4. fait un `gradlew clean` avant `assembleUniversalRelease` (anti frontend stale) ;
  5. signe l'APK avec apksigner auto-détecté (jamais de chemin en dur) ;
  6. uploade setup/sig/portable/apk, dérive `latest.json` + `index.html` depuis les
     URLs RÉELLES des assets, déploie Firebase.
- Usage : `powershell -ExecutionPolicy Bypass -File release.ps1` (bump auto) ou
  `-Version x.y.z`. `-SkipBuild` pour republier sans rebuild. Pas de mode
  « Android seulement » : une release incohérente (version disjointe Windows/Android)
  recrée une boucle de MAJ sur la plateforme non bumpée.

## Correctifs Android rapides (SANS publication)
Séquence à respecter dans l'ordre (sinon risque de frontend stale) :
1. `npm run build` (front)
2. `cargo build --release --target aarch64-linux-android` (avec CC/AR NDK,
   voir build.ps1) — le `.so` embarque le dist, donc DOIT tourner APRÈS le front
3. copier `libmedia_cli_lib.so` → `src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\`
4. `gradlew clean assembleUniversalRelease --offline` PUIS `apksigner sign`
5. `adb -s 2B151FDH3000FC install -r ...apk`
6. Vérifier la version réelle : `aapt dump badging <apk>` (versionName/versionCode)

## Pièges connus
- `gh release upload file#alias` définit un LABEL, pas le nom sur le disque : nommer
  le fichier localement AVANT upload (release.ps1 le fait).
- Un APK remplacé sur un MÊME tag/URL peut être servi en cache : toujours bump.
- Signature APK : keystore `APK\keystore\mediacli-release.keystore`, clés minisign
  `%USERPROFILE%\.tauri\mediacli.key(.pass)`.
- Apollo : ne pas éditer le frontend embarqué dans le `.so` sans recompiler cargo.

## Version
- VERSION doit toujours être bumpée pour publier. La MAJ in-app ne se propose que
  si `manifest.version > version installée` (`compareVersions`).
- Le localStorage `mediacli-update-dismissed` bloque les notifications en boucle :
  ne le retirer que si le mécanisme d'update change vraiment.