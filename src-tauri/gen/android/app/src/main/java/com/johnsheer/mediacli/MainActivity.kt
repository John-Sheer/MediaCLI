package com.johnsheer.mediacli

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestMediaPermissions()
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
