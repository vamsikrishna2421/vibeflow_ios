# Flow-session logic tests (no device / no Xcode needed)

Standalone Swift harnesses that exercise the pure logic of the dictation flow
module in isolation, so bugs in text accumulation can be caught deterministically
without building the app or dictating on a phone.

## Run

```sh
swift scripts/tests/flow_segment_harness.swift
```

Exit code 0 = all scenarios pass; non-zero = a regression.

## What `flow_segment_harness.swift` covers

It replicates the segment state-machine from
`modules/vibeflow-flowsession/ios/VibeflowFlowSessionModule.swift`
(`startUtterance` / `startSegment` / `segmentEnded` / `rotateSegment` /
`stopUtterance` / `finishUtterance` / `joinedTranscript`) and drives it through
the real-world event orderings:

- **S1** rotation from a pause preserves both parts
- **S2** an EMPTY on-device final must NOT wipe an earlier segment's good text
  (this is the "middle went missing" bug — regression guard for the empty-text filter)
- **S3** a killed/errored segment task keeps its last partial
- **S4** three chained segments all survive
- **S5** the stop watchdog delivers the full joined text if a final hangs
- **S6** back-to-back utterances both reach delivery (single-slot overwrite note)
- **S7** a single un-rotated segment delivers cleanly (the 45s-cap tier)
- **S8** self-heal path: an empty final while still current keeps the partial

If you change the segment/accumulation logic in the flow module, mirror it here
and keep every scenario green.
