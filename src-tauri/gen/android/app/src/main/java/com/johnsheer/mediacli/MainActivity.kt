package com.johnsheer.mediacli

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    try {
      android.webkit.WebView.setWebContentsDebuggingEnabled(true)
    } catch (_: Exception) {}

    try {
      val prefs = getSharedPreferences("wv_prefs", MODE_PRIVATE)
      var suffix = prefs.getString("wv_suffix", null)
      if (suffix == null) {
        suffix = "wv_${System.currentTimeMillis()}"
        prefs.edit().putString("wv_suffix", suffix).apply()
      }
      android.webkit.WebView.setDataDirectorySuffix(suffix)
    } catch (_: Exception) {}
    super.onCreate(savedInstanceState)
    try { baseContext.cacheDir.deleteRecursively() } catch (_: Exception) {}
    try { baseContext.codeCacheDir.deleteRecursively() } catch (_: Exception) {}
    try { deleteDatabase("WebViewCache.db") } catch (_: Exception) {}
    try { deleteDatabase("webviewCache.db") } catch (_: Exception) {}
    try { deleteDatabase("webview.db") } catch (_: Exception) {}
    requestMediaPermissions()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    webView.settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
    webView.settings.setSupportMultipleWindows(false)
    webView.clearCache(true)
    webView.clearHistory()
    webView.clearFormData()
    BackgroundBridge.webView = webView
  }

  override fun onBackPressed() {
    // Le bouton retour déclenche la même demande de confirmation que la croix
    // de la barre du haut : on transmet un événement au frontend qui affiche la
    // modale "Quitter MediaCLI ?". L'app n'est réellement fermée que si
    // l'utilisateur confirme (commande quit_app côté Rust).
    val view = BackgroundBridge.webView
    if (view != null) {
      view.post {
        view.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('quit-requested', { detail: 'back' }));",
          null
        )
      }
    } else {
      moveTaskToBack(true)
    }
  }

  override fun onStop() {
    BackgroundBridge.isInBackground = true
    super.onStop()
  }

  override fun onStart() {
    BackgroundBridge.isInBackground = false
    super.onStart()
  }

  override fun onDestroy() {
    BackgroundBridge.webView = null
    super.onDestroy()
  }

  private fun requestMediaPermissions() {
    val toAsk = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= 33) {
      toAsk.add(Manifest.permission.READ_MEDIA_AUDIO)
      toAsk.add(Manifest.permission.READ_MEDIA_VIDEO)
      toAsk.add(Manifest.permission.POST_NOTIFICATIONS)
    } else {
      toAsk.add(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    val missing = toAsk.filter {
      ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }.toTypedArray()
    if (missing.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, missing, 100)
    }
  }
}
