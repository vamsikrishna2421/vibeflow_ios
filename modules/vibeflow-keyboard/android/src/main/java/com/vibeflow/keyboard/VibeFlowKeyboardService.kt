package com.vibeflow.keyboard

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.inputmethodservice.InputMethodService
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * The VibeFlow on-screen keyboard — a voice-first IME. A big mic runs Android's
 * on-device SpeechRecognizer and types the result into whatever field has focus;
 * a compact control row handles space / backspace / enter / keyboard-switch; and
 * "Format" sends the just-dictated text to VibeFlow's Smart-Formatting endpoint
 * (using the session shared from the app) and swaps in the polished version.
 */
class VibeFlowKeyboardService : InputMethodService() {

  companion object {
    const val PREFS = "vibeflow_kbd"
    private const val BRAND = 0xFF7C5CFF.toInt()
    private const val BRAND_HI = 0xFF9B80FF.toInt()
    private const val LIVE = 0xFFE54749.toInt()
    private const val BG = 0xFF0D0A18.toInt()
    private const val CARD = 0xFF191527.toInt()
    private const val INK = 0xFFF4F2FB.toInt()
    private const val SOFT = 0xFFB4AECF.toInt()
  }

  private var recognizer: SpeechRecognizer? = null
  private var listening = false
  private var micButton: TextView? = null
  private var statusView: TextView? = null
  private var formatButton: TextView? = null
  // Text this keyboard has inserted since the last commit/format — the target for "Format".
  private val pending = StringBuilder()

  // ── view ────────────────────────────────────────────────────────────────────
  override fun onCreateInputView(): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(BG)
      setPadding(dp(10), dp(10), dp(10), dp(12))
    }

    statusView = TextView(this).apply {
      text = defaultHint()
      setTextColor(SOFT)
      textSize = 13f
      gravity = Gravity.CENTER
      maxLines = 2
      minHeight = dp(40)
      setPadding(dp(8), dp(4), dp(8), dp(4))
    }
    root.addView(statusView, rowLp())

    micButton = TextView(this).apply {
      text = "🎙" // 🎙
      textSize = 30f
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      background = circle(BRAND)
      elevation = dp(3).toFloat()
      setOnClickListener { toggleListening() }
    }
    val micWrap = FrameLayout(this).apply {
      addView(micButton, FrameLayout.LayoutParams(dp(80), dp(80), Gravity.CENTER))
    }
    root.addView(micWrap, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(112)))

    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    row.addView(key("🌐", CARD, INK) { switchKeyboard() }, weightLp(1f))     // 🌐
    row.addView(key("space", CARD, INK) { insert(" ") }, weightLp(2.6f))
    row.addView(key("⌫", CARD, INK) { backspace() }, weightLp(1f))                 // ⌫
    row.addView(key("⏎", BRAND, Color.WHITE) { enter() }, weightLp(1.2f))          // ⏎
    root.addView(row, rowLp(topMargin = dp(8)))

    formatButton = key("✨  Format", CARD, BRAND_HI) { formatPending() }
    root.addView(formatButton, rowLp(topMargin = dp(8)))

    updateFormatEnabled()
    return root
  }

  override fun onStartInputView(info: android.view.inputmethod.EditorInfo?, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    pending.setLength(0)
    listening = false
    setMicListening(false)
    statusView?.text = defaultHint()
    updateFormatEnabled()
  }

  override fun onDestroy() {
    recognizer?.destroy()
    recognizer = null
    super.onDestroy()
  }

  // ── speech ──────────────────────────────────────────────────────────────────
  private fun toggleListening() {
    if (listening) { stopListening(); return }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
      != PackageManager.PERMISSION_GRANTED
    ) {
      statusView?.text = "Open the VibeFlow app once and allow the microphone, then come back."
      return
    }
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      statusView?.text = "Speech recognition isn't available on this device."
      return
    }
    startListening()
  }

  private fun startListening() {
    recognizer?.destroy()
    recognizer = SpeechRecognizer.createSpeechRecognizer(this).also { it.setRecognitionListener(recognitionListener) }
    val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, java.util.Locale.getDefault().toString())
      // Prefer on-device so the user's voice stays on the phone (best-effort; falls back).
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      }
    }
    listening = true
    setMicListening(true)
    statusView?.text = "Listening…"
    recognizer?.startListening(intent)
  }

  private fun stopListening() {
    listening = false
    setMicListening(false)
    recognizer?.stopListening()
  }

  private val recognitionListener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) { statusView?.text = "Listening…" }
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() { setMicListening(false) }
    override fun onPartialResults(partialResults: Bundle?) {
      val text = firstResult(partialResults)
      if (!text.isNullOrBlank()) statusView?.text = text
    }
    override fun onResults(results: Bundle?) {
      listening = false
      setMicListening(false)
      val text = firstResult(results)
      if (!text.isNullOrBlank()) {
        val out = if (pending.isEmpty()) capitalize(text) else " $text"
        insert(out)
        statusView?.text = "Tap the mic to add more, or ✨ Format"
      } else {
        statusView?.text = defaultHint()
      }
      updateFormatEnabled()
    }
    override fun onError(error: Int) {
      listening = false
      setMicListening(false)
      statusView?.text = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
          "Didn't catch that — tap the mic and try again."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
          "Open the VibeFlow app once and allow the microphone."
        else -> "Tap the mic to try again."
      }
    }
    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  private fun firstResult(b: Bundle?): String? =
    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

  // ── editing ─────────────────────────────────────────────────────────────────
  private fun insert(text: String) {
    currentInputConnection?.commitText(text, 1)
    pending.append(text)
    updateFormatEnabled()
  }

  private fun backspace() {
    val ic = currentInputConnection ?: return
    val sel = ic.getSelectedText(0)
    if (sel != null && sel.isNotEmpty()) ic.commitText("", 1) else ic.deleteSurroundingText(1, 0)
    if (pending.isNotEmpty()) pending.deleteCharAt(pending.length - 1)
    updateFormatEnabled()
  }

  private fun enter() {
    val ic = currentInputConnection ?: return
    val action = currentInputEditorInfo?.imeOptions?.and(android.view.inputmethod.EditorInfo.IME_MASK_ACTION)
      ?: android.view.inputmethod.EditorInfo.IME_ACTION_UNSPECIFIED
    if (action != android.view.inputmethod.EditorInfo.IME_ACTION_NONE &&
      action != android.view.inputmethod.EditorInfo.IME_ACTION_UNSPECIFIED
    ) {
      ic.performEditorAction(action)
    } else {
      ic.commitText("\n", 1)
      pending.append("\n")
    }
  }

  private fun switchKeyboard() {
    val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.showInputMethodPicker()
  }

  // ── smart formatting (server polish) ──────────────────────────────────────────
  private fun updateFormatEnabled() {
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val hasAuth = !prefs.getString("jwt", "").isNullOrBlank() && prefs.getBoolean("polishEnabled", false)
    val enabled = hasAuth && pending.toString().trim().length >= 2
    formatButton?.alpha = if (enabled) 1f else 0.4f
    formatButton?.isEnabled = enabled
  }

  private fun formatPending() {
    val text = pending.toString().trim()
    if (text.length < 2) return
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val jwt = prefs.getString("jwt", "") ?: ""
    val url = prefs.getString("url", "") ?: ""
    val anon = prefs.getString("anonKey", "") ?: ""
    val deviceId = prefs.getString("deviceId", "") ?: ""
    if (jwt.isBlank() || url.isBlank()) {
      statusView?.text = "Sign in on the VibeFlow app to use Format."
      return
    }
    statusView?.text = "✨ Formatting…"
    formatButton?.isEnabled = false
    thread {
      val polished = callPolish(url, anon, jwt, deviceId, text)
      runOnUi {
        if (polished != null && polished.isNotBlank()) {
          replacePending(polished)
          statusView?.text = "✨ Polished"
        } else {
          statusView?.text = "Couldn't format just now — your text is unchanged."
        }
        updateFormatEnabled()
      }
    }
  }

  private fun replacePending(polished: String) {
    val ic = currentInputConnection ?: return
    val n = pending.length
    if (n > 0) ic.deleteSurroundingText(n, 0)
    ic.commitText(polished, 1)
    pending.setLength(0)
    pending.append(polished)
  }

  private fun callPolish(url: String, anon: String, jwt: String, deviceId: String, text: String): String? {
    return try {
      val conn = (URL("$url/functions/v1/polish").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 12000
        readTimeout = 20000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Authorization", "Bearer $jwt")
        if (anon.isNotBlank()) setRequestProperty("apikey", anon)
      }
      val body = JSONObject()
        .put("text", text)
        .put("style", "cleanup")
        .put("device_id", deviceId)
        .put("platform", "android")
        .toString()
      conn.outputStream.use { it.write(body.toByteArray()) }
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val resp = stream?.bufferedReader()?.use { it.readText() } ?: ""
      if (code !in 200..299) return null
      JSONObject(resp).optString("text").ifBlank { null }
    } catch (e: Exception) {
      null
    }
  }

  // ── ui helpers ────────────────────────────────────────────────────────────────
  private fun setMicListening(active: Boolean) {
    micButton?.background = circle(if (active) LIVE else BRAND)
    micButton?.text = if (active) "⏹" else "🎙" // ⏹ / 🎙
  }

  private fun defaultHint() = "Tap the mic and speak — your words type where the cursor is."

  private fun capitalize(s: String): String =
    if (s.isEmpty()) s else s[0].uppercaseChar() + s.substring(1)

  private fun runOnUi(block: () -> Unit) {
    micButton?.post(block) ?: block()
  }

  private fun circle(color: Int) = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(color)
  }

  private fun key(label: String, bg: Int, fg: Int, onClick: () -> Unit): TextView =
    TextView(this).apply {
      text = label
      setTextColor(fg)
      textSize = 16f
      gravity = Gravity.CENTER
      minHeight = dp(48)
      background = rounded(bg)
      outlineProvider = ViewOutlineProvider.BACKGROUND
      clipToOutline = true
      isClickable = true
      setOnClickListener { onClick() }
    }

  private fun rounded(color: Int) = GradientDrawable().apply {
    shape = GradientDrawable.RECTANGLE
    cornerRadius = dp(12).toFloat()
    setColor(color)
  }

  private fun rowLp(topMargin: Int = 0) = LinearLayout.LayoutParams(
    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
  ).apply { if (topMargin != 0) this.topMargin = topMargin }

  private fun weightLp(weight: Float) = LinearLayout.LayoutParams(
    0, ViewGroup.LayoutParams.WRAP_CONTENT, weight,
  ).apply { marginStart = dp(3); marginEnd = dp(3) }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
