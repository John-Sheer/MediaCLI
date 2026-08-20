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
      val suffix = "wv_${packageManager.getPackageInfo(packageName, 0).longVersionCode}"
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
    webView.settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
    webView.settings.setSupportMultipleWindows(false)
    webView.clearCache(true)
    webView.clearHistory()
    webView.clearFormData()
    BackgroundBridge.webView = webView
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
    val toAsk = if (Build.VERSION.SDK_INT >= 33) {
      arrayOf(
        Manifest.permission.READ_MEDIA_AUDIO,
        Manifest.permission.READ_MEDIA_VIDEO
      )
    } else {
      arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    val missing = toAsk.filter {
      ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }.toTypedArray()
    if (missing.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, missing, 100)
    }
  }
}
