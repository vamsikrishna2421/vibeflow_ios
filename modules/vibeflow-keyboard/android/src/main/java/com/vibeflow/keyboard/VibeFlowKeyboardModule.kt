package com.vibeflow.keyboard

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the VibeFlow keyboard. Lets the app check whether the IME is
 * enabled/selected, jump the user to the right system screens, and hand the
 * signed-in session down to the keyboard process (shared prefs, same app).
 */
class VibeFlowKeyboardModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private val serviceName: String
    get() = VibeFlowKeyboardService::class.java.name // com.vibeflow.keyboard.VibeFlowKeyboardService

  override fun definition() = ModuleDefinition {
    Name("VibeFlowKeyboard")

    Function("isEnabled") {
      val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      imm.enabledInputMethodList.any { it.serviceName == serviceName }
    }

    Function("isChosen") {
      val current = Settings.Secure.getString(
        context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD,
      ) ?: ""
      current.contains(serviceName)
    }

    Function("openImeSettings") {
      context.startActivity(
        Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    Function("openImePicker") {
      val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      imm.showInputMethodPicker()
    }

    Function("setAuth") { jwt: String, url: String, anonKey: String, deviceId: String ->
      context.getSharedPreferences(VibeFlowKeyboardService.PREFS, Context.MODE_PRIVATE).edit()
        .putString("jwt", jwt)
        .putString("url", url)
        .putString("anonKey", anonKey)
        .putString("deviceId", deviceId)
        .apply()
    }

    Function("setPolishEnabled") { enabled: Boolean ->
      context.getSharedPreferences(VibeFlowKeyboardService.PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean("polishEnabled", enabled)
        .apply()
    }
  }
}
