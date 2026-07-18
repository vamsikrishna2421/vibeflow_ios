// Standalone harness that faithfully replicates the segment state-machine from
// VibeflowFlowSessionModule.swift (startUtterance / startSegment / segmentEnded /
// rotateSegment / stopUtterance / finishUtterance / joinedTranscript).
//
// Real timers + SFSpeech callbacks are replaced by an explicit scenario driver that
// fires events in the SAME order the real system would, so the ACCUMULATION logic
// (what determines whether spoken text is lost) is exercised exactly.
//
// Goal: reproduce "long dictation → only the last line is typed" (issue 1) or prove
// the Swift accumulation is correct (pointing the bug at JS pipeline / keyboard).

import Foundation

final class FlowSim {
    // ---- state (mirrors the module) ----
    var utteranceActive = false
    var stopping = false
    var utteranceGen = 0
    var segmentSeq = 0
    var currentSeq = 0
    var utteranceSeqs: Set<Int> = []
    var segmentTexts: [Int: String] = [:]
    var endedSegments: Set<Int> = []
    var fastFails = 0

    // captured deliveries (what finishUtterance would hand to JS/keyboard)
    var delivered: [String] = []
    // captured single-slot writes to simulate latest_dictation overwrite (back-to-back)
    var latestDictationSlot: String = ""
    var slotWritesInOrder: [String] = []

    // ---- faithful methods ----
    func startUtterance() {
        utteranceGen += 1
        utteranceActive = true
        stopping = false
        segmentTexts = [:]
        endedSegments = []
        utteranceSeqs = []
        fastFails = 0
        startSegment()
        // (capTimer omitted; scenarios call stopUtterance() at the cap point)
    }

    func startSegment() {
        guard utteranceActive else { return }
        segmentSeq += 1
        let seq = segmentSeq
        currentSeq = seq
        utteranceSeqs.insert(seq)
    }

    // one SFSpeech callback for a given segment
    // FIX: only store NON-EMPTY text so an empty final (on-device emits one after a
    // rotated/closed segment) can never wipe a good partial. This is the real
    // "middle went missing" fix.
    func onRecognition(seq: Int, gen: Int, text: String?, isFinal: Bool, failed: Bool) {
        guard utteranceGen == gen else { return }  // stale utterance fence
        if let text, !text.trimmingCharacters(in: .whitespaces).isEmpty {
            segmentTexts[seq] = text
        }
        if isFinal || failed {
            segmentEnded(seq, gen: gen)
        }
    }

    func rotateSegment() {
        guard utteranceActive, !stopping else { return }
        startSegment()
        // real code then calls oldRequest.endAudio(); the scenario emits the old
        // segment's final event afterwards.
    }

    // livedShort: was the segment alive <1.5s with no text (fast-fail path)
    func segmentEnded(_ seq: Int, gen: Int, livedShortNoText: Bool = false) {
        guard utteranceActive, utteranceGen == gen, !endedSegments.contains(seq) else { return }
        endedSegments.insert(seq)
        if stopping {
            if endedSegments.isSuperset(of: utteranceSeqs) {
                let joined = joinedTranscript()
                finishUtterance(with: joined.isEmpty ? nil : joined)
            }
            return
        }
        guard seq == currentSeq else { return } // older segment finalising — done
        let gotText = !(segmentTexts[seq] ?? "").isEmpty
        if livedShortNoText && !gotText {
            fastFails += 1
            if fastFails >= 3 {
                let joined = joinedTranscript()
                finishUtterance(with: joined.isEmpty ? nil : joined)
                return
            }
        } else {
            fastFails = 0
        }
        startSegment()
    }

    func stopUtterance() {
        guard utteranceActive else { return }
        stopping = true
        // scenario emits the current segment's final after this; watchdog modelled by
        // the scenario calling watchdogFire() if delivery didn't happen.
    }

    func watchdogFire(gen: Int) {
        guard utteranceActive, utteranceGen == gen else { return }
        let joined = joinedTranscript()
        finishUtterance(with: joined.isEmpty ? nil : joined)
    }

    func finishUtterance(with text: String?) {
        guard utteranceActive else { return }
        utteranceActive = false
        stopping = false
        utteranceGen += 1
        segmentTexts = [:]
        endedSegments = []
        utteranceSeqs = []
        guard let text, !text.isEmpty else {
            delivered.append("<DIDN'T CATCH THAT>")
            return
        }
        delivered.append(text)
        // simulate JS writing the final into the single latest_dictation slot
        latestDictationSlot = text
        slotWritesInOrder.append(text)
    }

    func joinedTranscript() -> String {
        segmentTexts
            .sorted { $0.key < $1.key }
            .map { $0.value.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}

// ---- test scaffolding ----
var failures = 0
func check(_ name: String, got: String, expect: String) {
    let ok = got == expect
    if !ok { failures += 1 }
    print("\(ok ? "✅ PASS" : "❌ FAIL")  \(name)")
    if !ok {
        print("     expected: \"\(expect)\"")
        print("     got:      \"\(got)\"")
    }
}

// =====================================================================
// Scenario 1: continuous long speech, ONE rotation from a pause after 40s.
// seg1 speaks "part one two three", pause → rotate → seg2 "part four five",
// cap at 45s → stop. Expect: full "part one two three part four five".
// =====================================================================
do {
    let s = FlowSim()
    s.startUtterance()                       // seg1 (seq=1), gen=1
    let g = s.utteranceGen
    s.onRecognition(seq: 1, gen: g, text: "part one two three", isFinal: false, failed: false)
    // pause after 40s → rotation
    s.rotateSegment()                        // seg2 (seq=2), currentSeq=2
    // seg1's request.endAudio → seg1 final arrives (may be same text or empty)
    s.onRecognition(seq: 1, gen: g, text: "part one two three", isFinal: true, failed: false)
    // seg2 speaks
    s.onRecognition(seq: 2, gen: g, text: "part four five", isFinal: false, failed: false)
    // cap at 45s
    s.stopUtterance()
    s.onRecognition(seq: 2, gen: g, text: "part four five", isFinal: true, failed: false)
    check("S1 rotation (pause) preserves both parts",
          got: s.delivered.last ?? "", expect: "part one two three part four five")
}

// =====================================================================
// Scenario 2: seg1 final arrives EMPTY after endAudio (on-device sometimes
// returns an empty isFinal once the buffer is closed). seg1 kept its last
// partial though — does it survive? (segmentTexts[1] only overwritten if text != nil)
// =====================================================================
do {
    let s = FlowSim()
    s.startUtterance()
    let g = s.utteranceGen
    s.onRecognition(seq: 1, gen: g, text: "hello there friend", isFinal: false, failed: false)
    s.rotateSegment()
    // seg1 final arrives with EMPTY string (text = "") — NOTE: overwrites segmentTexts[1]!
    s.onRecognition(seq: 1, gen: g, text: "", isFinal: true, failed: false)
    s.onRecognition(seq: 2, gen: g, text: "second part here", isFinal: false, failed: false)
    s.stopUtterance()
    s.onRecognition(seq: 2, gen: g, text: "second part here", isFinal: true, failed: false)
    check("S2 seg1 empty-final overwrite",
          got: s.delivered.last ?? "", expect: "hello there friend second part here")
}

// =====================================================================
// Scenario 3: seg1 final arrives as NIL (error/killed) after rotation — the
// on-device recognizer only allows one active task, so seg1 is torn down with
// an error. text=nil → segmentTexts[1] keeps its partial. Should survive.
// =====================================================================
do {
    let s = FlowSim()
    s.startUtterance()
    let g = s.utteranceGen
    s.onRecognition(seq: 1, gen: g, text: "alpha bravo charlie", isFinal: false, failed: false)
    s.rotateSegment()
    s.onRecognition(seq: 1, gen: g, text: nil, isFinal: false, failed: true)  // killed
    s.onRecognition(seq: 2, gen: g, text: "delta echo", isFinal: false, failed: false)
    s.stopUtterance()
    s.onRecognition(seq: 2, gen: g, text: "delta echo", isFinal: true, failed: false)
    check("S3 seg1 killed-task keeps partial",
          got: s.delivered.last ?? "", expect: "alpha bravo charlie delta echo")
}

// =====================================================================
// Scenario 4: MANY rotations (long 3-segment dictation), stop mid-3rd.
// =====================================================================
do {
    let s = FlowSim()
    s.startUtterance()
    let g = s.utteranceGen
    s.onRecognition(seq: 1, gen: g, text: "one", isFinal: false, failed: false)
    s.rotateSegment()
    s.onRecognition(seq: 1, gen: g, text: "one", isFinal: true, failed: false)
    s.onRecognition(seq: 2, gen: g, text: "two", isFinal: false, failed: false)
    s.rotateSegment()
    s.onRecognition(seq: 2, gen: g, text: "two", isFinal: true, failed: false)
    s.onRecognition(seq: 3, gen: g, text: "three", isFinal: false, failed: false)
    s.stopUtterance()
    s.onRecognition(seq: 3, gen: g, text: "three", isFinal: true, failed: false)
    check("S4 three segments all survive", got: s.delivered.last ?? "", expect: "one two three")
}

// =====================================================================
// Scenario 5: STOP fires, but seg2's final NEVER arrives (hung task) → the
// 2.5s watchdog delivers joinedTranscript. seg2 kept a partial.
// =====================================================================
do {
    let s = FlowSim()
    s.startUtterance()
    let g = s.utteranceGen
    s.onRecognition(seq: 1, gen: g, text: "morning notes", isFinal: false, failed: false)
    s.rotateSegment()
    s.onRecognition(seq: 1, gen: g, text: "morning notes", isFinal: true, failed: false)
    s.onRecognition(seq: 2, gen: g, text: "afternoon plan", isFinal: false, failed: false)
    s.stopUtterance()
    // seg2 final never arrives; watchdog fires
    s.watchdogFire(gen: g)
    check("S5 watchdog delivers full text on hung final",
          got: s.delivered.last ?? "", expect: "morning notes afternoon plan")
}

// =====================================================================
// Scenario 6 (ISSUE 2 flavor): back-to-back utterances into the SINGLE
// latest_dictation slot. A delivers, keyboard hasn't read yet, B delivers and
// OVERWRITES the slot → A lost if keyboard only reads the slot once.
// This models the single-slot overwrite, not the segment machine.
// =====================================================================
do {
    let s = FlowSim()
    // utterance A
    s.startUtterance(); let gA = s.utteranceGen
    s.onRecognition(seq: 1, gen: gA, text: "first message", isFinal: false, failed: false)
    s.stopUtterance()
    s.onRecognition(seq: 1, gen: gA, text: "first message", isFinal: true, failed: false)
    // utterance B (keyboard hasn't consumed A's slot yet)
    s.startUtterance(); let gB = s.utteranceGen
    s.onRecognition(seq: s.currentSeq, gen: gB, text: "second message", isFinal: false, failed: false)
    s.stopUtterance()
    s.onRecognition(seq: s.currentSeq, gen: gB, text: "second message", isFinal: true, failed: false)
    let bothDelivered = s.delivered == ["first message", "second message"]
    print("\(bothDelivered ? "✅ PASS" : "❌ FAIL")  S6 both utterances reach finishUtterance")
    if !bothDelivered { failures += 1; print("     delivered: \(s.delivered)") }
    // slot after both: only the LAST survives in the single slot
    print("     latest_dictation slot writes in order: \(s.slotWritesInOrder)")
    print("     (keyboard dedupes by ts; if it reads the slot only after B wrote, A is never typed)")
}

// =====================================================================
// Scenario 7: single continuous segment (rotation DISABLED within the 45s
// cap). Whole dictation is one segment → one clean delivery, full text.
// =====================================================================
do {
    let s = FlowSim()
    s.startUtterance()
    let g = s.utteranceGen
    s.onRecognition(seq: 1, gen: g, text: "this is one long uninterrupted sentence for forty five seconds", isFinal: false, failed: false)
    s.stopUtterance()
    s.onRecognition(seq: 1, gen: g, text: "this is one long uninterrupted sentence for forty five seconds", isFinal: true, failed: false)
    check("S7 single-segment clean delivery",
          got: s.delivered.last ?? "",
          expect: "this is one long uninterrupted sentence for forty five seconds")
}

// =====================================================================
// Scenario 8: SELF-HEAL path — seg1 auto-finalises EMPTY while it is still the
// current segment (on-device sometimes returns an empty final), chains seg2.
// The good partial for seg1 must survive.
// =====================================================================
do {
    let s = FlowSim()
    s.startUtterance()
    let g = s.utteranceGen
    s.onRecognition(seq: 1, gen: g, text: "remember to buy milk", isFinal: false, failed: false)
    // seg1 emits an empty isFinal (currentSeq == 1, self-heal chains seg2)
    s.onRecognition(seq: 1, gen: g, text: "", isFinal: true, failed: false)
    s.onRecognition(seq: 2, gen: g, text: "and call the dentist", isFinal: false, failed: false)
    s.stopUtterance()
    s.onRecognition(seq: 2, gen: g, text: "and call the dentist", isFinal: true, failed: false)
    check("S8 self-heal empty-final keeps partial",
          got: s.delivered.last ?? "", expect: "remember to buy milk and call the dentist")
}

print("")
print(failures == 0 ? "ALL SEGMENT-MACHINE SCENARIOS PASS" : "\(failures) SCENARIO(S) FAILED")
exit(failures == 0 ? 0 : 1)
