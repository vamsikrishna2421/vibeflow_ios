package com.vibeflow.keyboard

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.concurrent.thread

/**
 * The VibeFlow keyboard — a complete system-style QWERTY keyboard with voice built
 * in, mirroring the iOS keyboard's layout:
 *
 *   ┌───────────── top strip: status / live partial · ✨Format · 🎤 mic ─────────────┐
 *   │  q w e r t y u i o p                                                           │
 *   │   a s d f g h j k l                                                            │
 *   │  ⇧  z x c v b n m  ⌫                                                           │
 *   │  ?123 · 🌐 · 😀 · [   VibeFlow   ] · return                                    │
 *   └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Pages: letters / numbers / symbols / emoji (same key sets as iOS). Shift supports
 * off → on → double-tap CAPS-LOCK, retitling letter keys in place (no rebuild).
 *
 * Voice (the part the old build got wrong): the mic is a MODE, not a one-shot.
 * `micMode` (user intent, drives the button colour) is kept separate from
 * `sessionActive` (an Android SpeechRecognizer session being open). Android's
 * recognizer auto-endpoints after ~1s of silence — while micMode is on we simply
 * commit the utterance and start the next session, so dictation feels continuous.
 * The button only ever changes when the USER taps it; endpointing never desyncs it.
 *
 * "✨ Format" sends everything this keyboard composed (typed + dictated) to the
 * VibeFlow polish endpoint using the session the app shares via SharedPreferences,
 * then swaps the raw text for the polished version in-place.
 */
class VibeFlowKeyboardService : InputMethodService() {

  companion object {
    const val PREFS = "vibeflow_kbd"
    private const val TAG = "VibeFlowKbd"

    private const val BRAND = 0xFF7C5CFF.toInt()
    private const val BRAND_HI = 0xFF9B80FF.toInt()
    private const val LIVE = 0xFFE54749.toInt()
    private const val BG = 0xFF0D0A18.toInt()
    private const val KEY = 0xFF2B2542.toInt() // regular character key
    private const val KEY_ALT = 0xFF1B1730.toInt() // special key (shift, ?123, …)
    private const val INK = 0xFFF4F2FB.toInt()
    private const val SOFT = 0xFFB4AECF.toInt()

    // Key sets — identical to the iOS keyboard's pages.
    private val ROW1 = listOf("q", "w", "e", "r", "t", "y", "u", "i", "o", "p")
    private val ROW2 = listOf("a", "s", "d", "f", "g", "h", "j", "k", "l")
    private val ROW3 = listOf("z", "x", "c", "v", "b", "n", "m")
    private val NUM1 = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0")
    private val NUM2 = listOf("-", "/", ":", ";", "(", ")", "$", "&", "@", "\"")
    private val SYM1 = listOf("[", "]", "{", "}", "#", "%", "^", "*", "+", "=")
    private val SYM2 = listOf("_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•")
    private val PUNCT = listOf(".", ",", "?", "!", "'")
    private val EMO1 = listOf("😀", "😂", "🥹", "❤️", "👍", "🙏", "😊", "🎉")
    private val EMO2 = listOf("😍", "🥰", "😭", "😅", "🤔", "👌", "🙌", "🔥")
    private val EMO3 = listOf("✨", "😎", "🤝", "👏", "💯", "🥳", "😢")

    private const val DOUBLE_TAP_MS = 300L
    private const val BACKSPACE_REPEAT_START_MS = 420L
    private const val BACKSPACE_REPEAT_MS = 55L
  }

  private enum class Page { LETTERS, NUMBERS, SYMBOLS, EMOJI }
  private enum class Shift { OFF, ON, LOCKED }

  private val ui = Handler(Looper.getMainLooper())

  // ── keyboard state ───────────────────────────────────────────────────────────
  private var page = Page.LETTERS
  private var shift = Shift.ON
  private var lastShiftTapAt = 0L
  private var lastSpaceTapAt = 0L

  // ── voice state (micMode = user intent; sessionActive = recognizer open) ─────
  private var recognizer: SpeechRecognizer? = null
  private var micMode = false
  private var sessionActive = false
  private var lastMicTapAt = 0L
  // Best partial seen in the CURRENT session. Some engines (Samsung/Google variants)
  // stream partials but then end the session with ERROR_NO_MATCH instead of a final
  // onResults — if we didn't commit this, whole utterances would vanish.
  private var sessionPartial = ""
  // Segments already committed in the CURRENT session (see hypothesis-reset below).
  private var segCommitted = 0
  // Stall watchdog: engines can go silent after a long utterance (no terminal
  // callback at all). If nothing arrives for too long, commit what we have + restart.
  private var lastCallbackAt = 0L
  private val stallWatchdog = object : Runnable {
    override fun run() {
      if (!micMode) return
      val quiet = System.currentTimeMillis() - lastCallbackAt
      if (sessionActive && quiet > 12000) {
        Log.w(TAG, "watchdog: session stalled ${quiet}ms — committing partial + restarting")
        val leftover = sessionPartial.trim()
        sessionPartial = ""
        if (leftover.isNotBlank()) insert(smartJoin(leftover))
        startSession()
      }
      ui.postDelayed(this, 3000)
    }
  }

  // ── views ────────────────────────────────────────────────────────────────────
  private var rootView: LinearLayout? = null
  private var rowsHost: LinearLayout? = null
  private var statusView: TextView? = null
  private var micButton: ImageView? = null
  private var formatButton: TextView? = null
  private var shiftKey: TextView? = null
  private val letterKeys = mutableListOf<TextView>()

  // Everything this keyboard composed since focus — the target for ✨ Format.
  private val pending = StringBuilder()

  // ── lifecycle ────────────────────────────────────────────────────────────────
  override fun onCreateInputView(): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(BG)
      setPadding(dp(6), dp(8), dp(6), dp(6))
    }
    rootView = root

    root.addView(buildTopStrip(), rowLp(height = dp(46)))

    rowsHost = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    root.addView(rowsHost, rowLp(topMargin = dp(6)))

    rebuildKeys()
    updateFormatVisible()
    return root
  }

  override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    Log.d(TAG, "onStartInputView restarting=$restarting micMode=$micMode")
    // Rich editors (Samsung Notes!) RESTART the input view on ordinary text commits.
    // That's the same field — killing the dictation session there silently ate long
    // utterances. Only a genuinely new input (restarting=false) resets state.
    if (restarting) return
    pending.setLength(0)
    micMode = false
    destroyRecognizer() // a late result must never type into the newly-focused field
    paintMic()
    page = Page.LETTERS
    shift = Shift.ON
    rebuildKeys()
    statusView?.text = defaultHint()
    updateFormatVisible()
  }

  override fun onFinishInputView(finishingInput: Boolean) {
    micMode = false
    destroyRecognizer()
    paintMic()
    super.onFinishInputView(finishingInput)
  }

  override fun onDestroy() {
    destroyRecognizer()
    super.onDestroy()
  }

  // ── top strip: status · ✨ Format · mic ──────────────────────────────────────
  private fun buildTopStrip(): View {
    val strip = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }

    statusView = TextView(this).apply {
      text = defaultHint()
      setTextColor(SOFT)
      textSize = 13f
      maxLines = 2
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(8), 0, dp(8), 0)
    }
    strip.addView(statusView, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))

    formatButton = TextView(this).apply {
      text = "✨"
      textSize = 18f
      gravity = Gravity.CENTER
      background = rounded(KEY_ALT, 16)
      outlineProvider = ViewOutlineProvider.BACKGROUND
      clipToOutline = true
      isClickable = true
      visibility = View.GONE
      // The emoji glyph isn't a readable label for TalkBack — give it a real one.
      contentDescription = "Polish text with VibeFlow"
      setOnClickListener { haptic(it); formatPending() }
    }
    strip.addView(formatButton, LinearLayout.LayoutParams(dp(44), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(6) })

    // Wispr-style prominent mic at the top-right (exactly like iOS) — a proper
    // vector mic glyph (Material "mic", the WhatsApp-style shape), not an emoji.
    micButton = ImageView(this).apply {
      setImageResource(R.drawable.ic_mic)
      scaleType = ImageView.ScaleType.CENTER
      background = rounded(BRAND, 16)
      outlineProvider = ViewOutlineProvider.BACKGROUND
      clipToOutline = true
      isClickable = true
      contentDescription = "Start dictation" // updated to "Stop dictation" in paintMic
      setOnClickListener { haptic(it); micTapped() }
    }
    strip.addView(micButton, LinearLayout.LayoutParams(dp(56), ViewGroup.LayoutParams.MATCH_PARENT))

    return strip
  }

  // ── key pages (mirror of the iOS rebuildKeys) ────────────────────────────────
  private fun rebuildKeys() {
    val host = rowsHost ?: return
    host.removeAllViews()
    letterKeys.clear()
    shiftKey = null

    when (page) {
      Page.LETTERS -> {
        host.addView(charRow(ROW1, letters = true), rowLp(height = dp(48)))
        host.addView(insetRow(charRow(ROW2, letters = true), frac = 0.05f), rowLp(height = dp(48), topMargin = dp(6)))
        host.addView(lettersBottomRow(), rowLp(height = dp(48), topMargin = dp(6)))
      }
      Page.NUMBERS -> {
        host.addView(charRow(NUM1, letters = false), rowLp(height = dp(48)))
        host.addView(charRow(NUM2, letters = false), rowLp(height = dp(48), topMargin = dp(6)))
        host.addView(punctBottomRow("#+=") { page = Page.SYMBOLS; rebuildKeys() }, rowLp(height = dp(48), topMargin = dp(6)))
      }
      Page.SYMBOLS -> {
        host.addView(charRow(SYM1, letters = false), rowLp(height = dp(48)))
        host.addView(charRow(SYM2, letters = false), rowLp(height = dp(48), topMargin = dp(6)))
        host.addView(punctBottomRow("123") { page = Page.NUMBERS; rebuildKeys() }, rowLp(height = dp(48), topMargin = dp(6)))
      }
      Page.EMOJI -> {
        host.addView(charRow(EMO1, letters = false), rowLp(height = dp(48)))
        host.addView(charRow(EMO2, letters = false), rowLp(height = dp(48), topMargin = dp(6)))
        val last = charRow(EMO3, letters = false) as LinearLayout
        last.addView(backspaceKey(), weightLp(1.3f))
        host.addView(last, rowLp(height = dp(48), topMargin = dp(6)))
      }
    }
    host.addView(functionRow(), rowLp(height = dp(48), topMargin = dp(6)))
    autoShiftIfSentenceStart() // e.g. ". " typed on ?123 → returning to ABC arms caps
    applyShiftAppearance()
  }

  private fun charRow(keys: List<String>, letters: Boolean): View {
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    for (k in keys) {
      val key = charKey(k, letters)
      if (letters) letterKeys.add(key)
      row.addView(key, weightLp(1f))
    }
    return row
  }

  /** Center a row with fractional side insets (the a…l row, like iOS's `inset`). */
  private fun insetRow(row: View, frac: Float): View {
    val wrap = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    wrap.addView(View(this), LinearLayout.LayoutParams(0, 0, frac))
    wrap.addView(row, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f - 2 * frac))
    wrap.addView(View(this), LinearLayout.LayoutParams(0, 0, frac))
    return wrap
  }

  private fun lettersBottomRow(): View {
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    shiftKey = specialKey("⇧") { shiftTapped() }
    row.addView(shiftKey, weightLp(1.3f))
    for (k in ROW3) {
      val key = charKey(k, isLetter = true)
      letterKeys.add(key)
      row.addView(key, weightLp(1f))
    }
    row.addView(backspaceKey(), weightLp(1.3f))
    return row
  }

  private fun punctBottomRow(toggle: String, onToggle: () -> Unit): View {
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    row.addView(specialKey(toggle) { onToggle() }, weightLp(1.3f))
    for (k in PUNCT) row.addView(charKey(k, isLetter = false), weightLp(1f))
    row.addView(backspaceKey(), weightLp(1.3f))
    return row
  }

  /** Bottom row: ?123 · 🌐 · 😀 · space("VibeFlow") · return — same as iOS. */
  private fun functionRow(): View {
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }

    val mode = specialKey(if (page == Page.LETTERS || page == Page.EMOJI) "?123" else "ABC") {
      page = if (page == Page.LETTERS || page == Page.EMOJI) Page.NUMBERS else Page.LETTERS
      rebuildKeys()
    }
    row.addView(mode, weightLp(1.3f))

    row.addView(specialKey("🌐") { switchKeyboard() }, weightLp(1.1f))

    row.addView(
      specialKey(if (page == Page.EMOJI) "ABC" else "😀") {
        page = if (page == Page.EMOJI) Page.LETTERS else Page.EMOJI
        rebuildKeys()
      },
      weightLp(1.1f),
    )

    val space = TextView(this).apply {
      text = "VibeFlow"
      setTextColor(SOFT)
      textSize = 14f
      gravity = Gravity.CENTER
      background = rounded(KEY, 10)
      outlineProvider = ViewOutlineProvider.BACKGROUND
      clipToOutline = true
      isClickable = true
      setOnClickListener { haptic(it); spaceTapped() }
    }
    row.addView(space, weightLp(4f))

    val ret = specialKey("⏎") { enter() }
    ret.background = rounded(BRAND, 10)
    ret.setTextColor(Color.WHITE)
    row.addView(ret, weightLp(1.6f))

    return row
  }

  // ── key factories ────────────────────────────────────────────────────────────
  @SuppressLint("ClickableViewAccessibility")
  private fun charKey(base: String, isLetter: Boolean): TextView =
    TextView(this).apply {
      text = if (isLetter && shift != Shift.OFF) base.uppercase(Locale.getDefault()) else base
      tag = base
      setTextColor(INK)
      textSize = if (isLetter) 19f else 17f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
      gravity = Gravity.CENTER
      background = rounded(KEY, 10)
      outlineProvider = ViewOutlineProvider.BACKGROUND
      clipToOutline = true
      isClickable = true
      setOnClickListener {
        haptic(it)
        val ch = if (isLetter && shift != Shift.OFF) base.uppercase(Locale.getDefault()) else base
        insert(ch)
        if (isLetter && shift == Shift.ON) { // one-shot shift releases after a letter
          shift = Shift.OFF
          applyShiftAppearance()
        }
      }
    }

  private fun specialKey(label: String, onClick: () -> Unit): TextView =
    TextView(this).apply {
      text = label
      setTextColor(INK)
      textSize = 16f
      gravity = Gravity.CENTER
      background = rounded(KEY_ALT, 10)
      outlineProvider = ViewOutlineProvider.BACKGROUND
      clipToOutline = true
      isClickable = true
      setOnClickListener { haptic(it); onClick() }
    }

  /** Backspace with press-and-hold auto-repeat (like every real keyboard). */
  @SuppressLint("ClickableViewAccessibility")
  private fun backspaceKey(): TextView {
    val key = specialKey("⌫") {}
    var repeating = false
    val repeat = object : Runnable {
      override fun run() {
        if (!repeating) return
        backspace()
        ui.postDelayed(this, BACKSPACE_REPEAT_MS)
      }
    }
    key.setOnTouchListener { v, e ->
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          haptic(v)
          backspace()
          repeating = true
          // Remove only OUR runnable — never sweep the shared handler (that would
          // cancel pending mic-session restarts too).
          ui.removeCallbacks(repeat)
          ui.postDelayed(repeat, BACKSPACE_REPEAT_START_MS)
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          repeating = false
          ui.removeCallbacks(repeat)
        }
      }
      true
    }
    return key
  }

  // ── shift ────────────────────────────────────────────────────────────────────
  private fun shiftTapped() {
    val now = System.currentTimeMillis()
    shift = when {
      now - lastShiftTapAt < DOUBLE_TAP_MS -> Shift.LOCKED // double-tap = caps lock
      shift == Shift.OFF -> Shift.ON
      else -> Shift.OFF
    }
    lastShiftTapAt = now
    applyShiftAppearance()
  }

  /** Retitle letter keys in place — no rebuild, typing stays snappy (like iOS). */
  private fun applyShiftAppearance() {
    val up = shift != Shift.OFF
    for (k in letterKeys) {
      val base = k.tag as? String ?: continue
      k.text = if (up) base.uppercase(Locale.getDefault()) else base
    }
    shiftKey?.apply {
      text = if (shift == Shift.LOCKED) "⇪" else "⇧"
      background = rounded(if (shift != Shift.OFF) BRAND else KEY_ALT, 10)
      setTextColor(if (shift != Shift.OFF) Color.WHITE else INK)
    }
  }

  /**
   * Auto-capitalize like Gboard: ask the FIELD via getCursorCapsMode, which honors
   * its declared capitalization (sentences/words/characters) — so email, username
   * and code fields (no cap flags) never get forced caps. Fields that aren't
   * TYPE_CLASS_TEXT fall back to a local sentence heuristic.
   * NOTE: no page guard — the period key lives on the ?123 page; state must update
   * everywhere (rendering is safely page-scoped in applyShiftAppearance).
   */
  private fun autoShiftIfSentenceStart() {
    if (shift == Shift.LOCKED) return
    val ic = currentInputConnection ?: return
    val inputType = currentInputEditorInfo?.inputType ?: 0
    val should: Boolean
    if ((inputType and android.text.InputType.TYPE_MASK_CLASS) == android.text.InputType.TYPE_CLASS_TEXT) {
      val capFlags = inputType and (
        android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
          android.text.InputType.TYPE_TEXT_FLAG_CAP_WORDS or
          android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        )
      should = if (capFlags != 0) ic.getCursorCapsMode(inputType) != 0 else false
    } else {
      val before = ic.getTextBeforeCursor(3, 0)?.toString() ?: ""
      val trimmed = before.trimEnd()
      val afterSentence = before.endsWith(" ") &&
        (trimmed.endsWith(".") || trimmed.endsWith("?") || trimmed.endsWith("!"))
      should = before.isEmpty() || trimmed.isEmpty() || afterSentence || before.endsWith("\n")
    }
    if (should != (shift == Shift.ON)) {
      shift = if (should) Shift.ON else Shift.OFF
      applyShiftAppearance()
    }
  }

  // ── space / enter / switch ───────────────────────────────────────────────────
  private fun spaceTapped() {
    val now = System.currentTimeMillis()
    capitalizeLoneI()
    // Double-space → ". " (with the space that was just typed replaced), like iOS.
    if (now - lastSpaceTapAt < DOUBLE_TAP_MS && pending.isNotEmpty() && pending.last() == ' ' &&
      pending.length >= 2 && pending[pending.length - 2].isLetterOrDigit()
    ) {
      currentInputConnection?.deleteSurroundingText(1, 0)
      pending.deleteCharAt(pending.length - 1)
      insert(". ")
    } else {
      insert(" ")
    }
    lastSpaceTapAt = now // insert() already re-derived the shift state
  }

  /** Standalone "i" becomes "I" when a space follows — the classic system fix. */
  private fun capitalizeLoneI() {
    val ic = currentInputConnection ?: return
    val before = ic.getTextBeforeCursor(3, 0)?.toString() ?: return
    if (!before.endsWith("i")) return
    val prior = before.dropLast(1).lastOrNull()
    if (prior == null || (!prior.isLetter() && prior != '\'')) {
      ic.deleteSurroundingText(1, 0)
      ic.commitText("I", 1)
      if (pending.isNotEmpty() && pending.last() == 'i') {
        pending.setCharAt(pending.length - 1, 'I')
      }
    }
  }

  private fun enter() {
    val ic = currentInputConnection ?: return
    val action = currentInputEditorInfo?.imeOptions?.and(EditorInfo.IME_MASK_ACTION)
      ?: EditorInfo.IME_ACTION_UNSPECIFIED
    if (action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
      ic.performEditorAction(action)
    } else {
      insert("\n") // insert() re-derives the shift state
    }
  }

  private fun switchKeyboard() {
    // Prefer a direct hop back to the previous keyboard (like iOS's globe);
    // fall back to the system picker.
    val switched = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) switchToPreviousInputMethod() else false
    if (!switched) {
      (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
    }
  }

  // ── editing ──────────────────────────────────────────────────────────────────
  private fun insert(text: String) {
    currentInputConnection?.commitText(text, 1)
    pending.append(text)
    autoShiftIfSentenceStart() // every commit re-derives caps (typed, punct, dictated)
    updateFormatVisible()
  }

  private fun backspace() {
    val ic = currentInputConnection ?: return
    val sel = ic.getSelectedText(0)
    if (sel != null && sel.isNotEmpty()) ic.commitText("", 1) else ic.deleteSurroundingText(1, 0)
    if (pending.isNotEmpty()) pending.deleteCharAt(pending.length - 1)
    autoShiftIfSentenceStart() // deleting back to a sentence start re-arms caps
    updateFormatVisible()
  }

  // ── voice: continuous dictation with an honest state machine ────────────────
  private fun micTapped() {
    val now = System.currentTimeMillis()
    if (now - lastMicTapAt < 250) return // debounce accidental double-taps
    lastMicTapAt = now

    if (micMode) { stopDictation(silent = false); return }

    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      statusView?.text = "Open the VibeFlow app once and allow the microphone, then come back."
      return
    }
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      statusView?.text = "Speech recognition isn't available on this device."
      return
    }
    micMode = true
    paintMic()
    statusView?.text = "Listening…"
    lastCallbackAt = System.currentTimeMillis()
    ui.removeCallbacks(stallWatchdog)
    ui.postDelayed(stallWatchdog, 3000)
    startSession()
  }

  private fun stopDictation(silent: Boolean) {
    Log.d(TAG, "stopDictation silent=$silent sessionActive=$sessionActive partial='${sessionPartial.take(40)}'")
    micMode = false
    ui.removeCallbacks(stallWatchdog)
    paintMic()
    // Ask for the final result of the open session (results may still arrive — fine).
    try { recognizer?.stopListening() } catch (_: Throwable) {}
    if (!silent) statusView?.text = if (pending.isNotEmpty()) "Tap ✨ to polish, or keep going" else defaultHint()
  }

  /** Open one recognizer session. While micMode stays on, sessions chain. */
  private fun startSession() {
    if (!micMode) return
    sessionPartial = ""
    segCommitted = 0
    destroyRecognizer()
    recognizer = SpeechRecognizer.createSpeechRecognizer(this).also {
      it.setRecognitionListener(listener)
    }
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toString())
      // Server-assisted by default: low-end devices often lack offline models, and
      // forcing offline was a big source of "mic does nothing". The app can flip
      // this via shared prefs when the user turns On-device only on.
      if (getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("preferOffline", false)) {
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      }
      // Longer silence before auto-endpointing, where the engine honors it.
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1600)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1600)
    }
    sessionActive = true
    recognizer?.startListening(intent)
  }

  private fun destroyRecognizer() {
    try { recognizer?.destroy() } catch (_: Throwable) {}
    recognizer = null
    sessionActive = false
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {
      lastCallbackAt = System.currentTimeMillis()
      Log.d(TAG, "onReadyForSpeech")
      if (micMode) statusView?.text = "Listening…"
    }

    override fun onPartialResults(partialResults: Bundle?) {
      lastCallbackAt = System.currentTimeMillis()
      val text = firstResult(partialResults)
      if (text.isNullOrBlank()) return
      val prev = sessionPartial
      // HYPOTHESIS RESET: within one session the engine can silently finish a phrase
      // and start a fresh hypothesis — the new partial suddenly SHRINKS to just the
      // new phrase, and the final result will only cover that last phrase. If we
      // didn't commit the finished phrase here, it would be lost ("overwritten").
      // A same-phrase rewrite never drops this much text at once, so a big shrink
      // with a non-extending prefix is a reliable segment boundary.
      if (prev.length >= 12 && text.length <= prev.length - 12 && !prev.startsWith(text)) {
        Log.d(TAG, "partial RESET: committing segment len=${prev.length}, new='${text.take(30)}'")
        insert(smartJoin(prev.trim()))
        segCommitted++
      }
      sessionPartial = text
      if (micMode) statusView?.text = text
    }

    override fun onResults(results: Bundle?) {
      lastCallbackAt = System.currentTimeMillis()
      sessionActive = false
      val final = firstResult(results)?.trim()
      Log.d(TAG, "onResults final.len=${final?.length ?: -1} partial.len=${sessionPartial.length} segCommitted=$segCommitted")
      // If we already committed segments this session, the engine's "final" only
      // covers the LAST phrase (that's what caused the loss) — commit the last
      // partial instead so nothing doubles. Otherwise prefer the engine's final.
      val text = if (segCommitted > 0) sessionPartial.trim()
      else if (final.isNullOrBlank()) sessionPartial.trim() else final
      sessionPartial = ""
      if (text.isNotBlank()) {
        insert(smartJoin(text))
        statusView?.text = if (micMode) "Listening…" else "Tap ✨ to polish, or keep going"
      }
      // Continuous: the user hasn't tapped stop, so open the next session.
      if (micMode) ui.postDelayed({ startSession() }, 80)
    }

    override fun onError(error: Int) {
      lastCallbackAt = System.currentTimeMillis()
      sessionActive = false
      Log.d(TAG, "onError code=$error partial.len=${sessionPartial.length} micMode=$micMode")
      // A session that dies with text on the table still owes us that text — some
      // engines end via NO_MATCH/TIMEOUT after streaming perfectly good partials.
      val leftover = sessionPartial.trim()
      sessionPartial = ""
      if (leftover.isNotBlank()) {
        insert(smartJoin(leftover))
        if (micMode) statusView?.text = "Listening…"
      }
      when (error) {
        // Silence / nothing recognized — normal pauses in continuous mode: chain on.
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {
          if (micMode) ui.postDelayed({ startSession() }, 120)
        }
        // Engine hiccup — recreate the client and keep going.
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> {
          if (micMode) ui.postDelayed({ startSession() }, 250)
        }
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
          micMode = false
          paintMic()
          statusView?.text = "Open the VibeFlow app once and allow the microphone."
        }
        // Transient network/server hiccups shouldn't end the user's dictation MODE —
        // the utterance (if any) was already committed above; chain a fresh session.
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> {
          if (micMode) ui.postDelayed({ startSession() }, 400)
        }
        else -> {
          micMode = false
          ui.removeCallbacks(stallWatchdog)
          paintMic()
          statusView?.text = "Mic hit a snag — tap it to try again."
        }
      }
    }

    override fun onEndOfSpeech() {
      lastCallbackAt = System.currentTimeMillis()
      Log.d(TAG, "onEndOfSpeech")
      // Long utterances take the engine a few seconds to finalize — show it, so the
      // quiet gap doesn't read as "it ate my words".
      if (micMode && sessionPartial.isNotBlank()) statusView?.text = "Finishing up…"
    }

    override fun onBeginningOfSpeech() { lastCallbackAt = System.currentTimeMillis() }
    override fun onRmsChanged(rmsdB: Float) { lastCallbackAt = System.currentTimeMillis() }
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  private fun firstResult(b: Bundle?): String? =
    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

  /** Join a dictated utterance onto what's already there with sane spacing/casing. */
  private fun smartJoin(utterance: String): String {
    val before = currentInputConnection?.getTextBeforeCursor(2, 0)?.toString() ?: ""
    val atStart = before.isBlank()
    val sentenceStart = atStart || before.trimEnd().endsWith(".") || before.trimEnd().endsWith("?") ||
      before.trimEnd().endsWith("!") || before.endsWith("\n")
    var out = if (sentenceStart) utterance.replaceFirstChar { it.uppercase(Locale.getDefault()) } else utterance
    if (!atStart && !before.endsWith(" ") && !before.endsWith("\n")) out = " $out"
    return out
  }

  private fun paintMic() {
    micButton?.background = rounded(if (micMode) LIVE else BRAND, 16)
    micButton?.setImageResource(if (micMode) R.drawable.ic_stop else R.drawable.ic_mic)
    micButton?.contentDescription = if (micMode) "Stop dictation" else "Start dictation"
    // Hold the screen awake WHILE dictating so it never dims mid-speech. Without this the
    // screen sleeps, the user taps to wake it, the tap lands in the text field and moves
    // the cursor, and the next recognized words insert at that wrong spot — jumbling the
    // sentence. keepScreenOn on the visible keyboard view keeps the display on with no wake
    // lock and no permission; it clears automatically when micMode ends.
    rootView?.keepScreenOn = micMode
  }

  // ── ✨ Format (server polish) ─────────────────────────────────────────────────
  // Polishes what this keyboard composed (`pending`); when that's empty (fresh
  // keyboard process / pre-existing text), it polishes the WHOLE field instead.
  private fun updateFormatVisible() {
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val hasAuth = !prefs.getString("jwt", "").isNullOrBlank() && prefs.getBoolean("polishEnabled", false)
    val hasText = pending.toString().trim().length >= 2 ||
      (currentInputConnection?.getTextBeforeCursor(4, 0)?.toString()?.trim()?.length ?: 0) >= 2
    formatButton?.visibility = if (hasAuth && hasText) View.VISIBLE else View.GONE
  }

  private fun formatPending() {
    val ic = currentInputConnection
    // Whole-field fallback: format everything around the cursor when the keyboard
    // didn't compose the text itself. (Server caps input at 20k chars.)
    var fieldBefore = ""
    var fieldAfter = ""
    var text = pending.toString().trim()
    var wholeField = false
    if (text.length < 2 && ic != null) {
      fieldBefore = ic.getTextBeforeCursor(18000, 0)?.toString() ?: ""
      fieldAfter = ic.getTextAfterCursor(18000, 0)?.toString() ?: ""
      text = (fieldBefore + fieldAfter).trim()
      wholeField = true
    }
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
    formatButton?.alpha = 0.5f // visible disabled state during the network call
    thread {
      val (polished, code) = callPolish(url, anon, jwt, deviceId, text)
      ui.post {
        formatButton?.isEnabled = true
        formatButton?.alpha = 1f
        when {
          polished != null && polished.isNotBlank() -> {
            if (wholeField) replaceWholeField(fieldBefore, fieldAfter, polished)
            else replacePending(polished)
            statusView?.text = "✨ Polished"
          }
          // The shared JWT is a snapshot that expires ~hourly; the app re-shares a
          // fresh one whenever it comes to the foreground.
          code == 401 -> statusView?.text = "Sign-in refresh needed — open VibeFlow for a moment, then try again."
          code == 402 -> statusView?.text = "Free polish limit reached for this week."
          else -> statusView?.text = "Couldn't format just now — your text is unchanged."
        }
        updateFormatVisible()
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

  /** Swap the ENTIRE field for the polished text (whole-field Format fallback). */
  private fun replaceWholeField(before: String, after: String, polished: String) {
    val ic = currentInputConnection ?: return
    ic.beginBatchEdit()
    ic.deleteSurroundingText(before.length, after.length)
    ic.commitText(polished, 1)
    ic.endBatchEdit()
    pending.setLength(0)
    pending.append(polished)
  }

  /** Returns polished text (or null) plus the HTTP status (0 = network failure). */
  private fun callPolish(url: String, anon: String, jwt: String, deviceId: String, text: String): Pair<String?, Int> {
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
      Log.d(TAG, "polish HTTP $code (${resp.length} bytes)")
      if (code !in 200..299) return Pair(null, code)
      Pair(JSONObject(resp).optString("text").ifBlank { null }, code)
    } catch (e: Exception) {
      Log.w(TAG, "polish network failure: $e")
      Pair(null, 0)
    }
  }

  // ── ui helpers ────────────────────────────────────────────────────────────────
  private fun defaultHint() = "Type, or tap the mic and just talk."

  private fun haptic(v: View) {
    v.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
  }

  private fun rounded(color: Int, radiusDp: Int) = GradientDrawable().apply {
    shape = GradientDrawable.RECTANGLE
    cornerRadius = dp(radiusDp).toFloat()
    setColor(color)
  }

  private fun rowLp(height: Int = ViewGroup.LayoutParams.WRAP_CONTENT, topMargin: Int = 0) =
    LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height).apply {
      if (topMargin != 0) this.topMargin = topMargin
    }

  private fun weightLp(weight: Float) = LinearLayout.LayoutParams(
    0, ViewGroup.LayoutParams.MATCH_PARENT, weight,
  ).apply { marginStart = dp(2); marginEnd = dp(2) }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
