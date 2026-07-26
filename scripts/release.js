#!/usr/bin/env node

/**
 * Script de release MediaCLI
 * 
 * Usage:
 *   node scripts/release.js <version>
 * 
 * Exemple:
 *   node scripts/release.js 0.2.0
 * 
 * Ce script:
 * 1. Met à jour la version dans package.json et tauri.conf.json
 * 2. Met à jour le manifest latest.json
 * 3. Copie l'APK dans hosting/updates/
 * 4. Affiche les instructions de déploiement
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/release.js <version>");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Version invalide. Format attendu: X.Y.Z");
  process.exit(1);
}

console.log(`\n🎵 Release MediaCLI v${version}\n`);

// 1. Update package.json
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`✅ package.json → v${version}`);

// 2. Update tauri.conf.json
const tauriPath = join(ROOT, "src-tauri", "tauri.conf.json");
const tauri = JSON.parse(readFileSync(tauriPath, "utf-8"));
tauri.version = version;
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");
console.log(`✅ tauri.conf.json → v${version}`);

// 3. Update latest.json
const manifestPath = join(ROOT, "hosting", "updates", "latest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
manifest.version = version;
manifest.pub_date = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`✅ latest.json → v${version}`);

// 4. Copy APK if it exists
const apkPaths = [
  join(ROOT, "src-tauri", "gen", "android", "app", "build", "outputs", "apk", "arm64", "debug", "app-arm64-debug.apk"),
  join(ROOT, "src-tauri", "gen", "android", "app", "build", "outputs", "apk", "arm64", "release", "app-arm64-release.apk"),
];

const destApk = join(ROOT, "hosting", "updates", "latest.apk");
let apkCopied = false;

for (const apkPath of apkPaths) {
  if (existsSync(apkPath)) {
    copyFileSync(apkPath, destApk);
    console.log(`✅ APK copié → hosting/updates/latest.apk`);
    apkCopied = true;
    break;
  }
}

if (!apkCopied) {
  console.log(`⚠️  Aucun APK trouvé. Copiez manuellement l'APK dans hosting/updates/latest.apk`);
}

// 5. Summary
console.log(`\n📋 Prochaines étapes:\n`);
console.log(`  1. Build l'APK:`);
console.log(`     npx tauri android build --target aarch64`);
console.log(``);
console.log(`  2. Copie le .so + APK (si pas déjà fait):`);
console.log(`     Copy-Item -Force src-tauri\\target\\aarch64-linux-android\\release\\libmedia_cli_lib.so src-tauri\\gen\\android\\app\\src\\main\\jniLibs\\arm64-v8a\\libmedia_cli_lib.so`);
console.log(`     Copy-Item -Force <apk> hosting\\updates\\latest.apk`);
console.log(``);
console.log(`  3. Déploie sur Firebase:`);
console.log(`     npm install -g firebase-tools`);
console.log(`     firebase login`);
console.log(`     firebase deploy --only hosting`);
console.log(``);
console.log(`  4. Ou déploie manuellement sur ton portfolio.`);
console.log(``);
console.log(`📦 Version ${version} prête!\n`);
