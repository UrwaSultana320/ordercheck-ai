import { commandFrom } from "../src/lib/session";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceController, type Recognition } from "../src/lib/voice";
class FakeRecognition implements Recognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: Recognition["onstart"] = null;
  onend: Recognition["onend"] = null;
  onerror: Recognition["onerror"] = null;
  onresult: Recognition["onresult"] = null;
  aborted = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.onstart?.();
  }
  abort() {
    this.aborted = true;
    this.onend?.();
  }
  result(text: string, final = true) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: final, 0: { transcript: text } }],
    });
  }
}
function fixture(supported = true) {
  FakeRecognition.instances = [];
  const speeches: SpeechSynthesisUtterance[] = [];
  const events = {
    command: vi.fn<(command: import("../src/lib/session").Command) => void | Promise<void>>(),
    listening: vi.fn(),
    speaking: vi.fn(),
    error: vi.fn(),
  };
  const active = { value: true };
  const cancel = vi.fn();
  const controller = new VoiceController(
    {
      recognition: supported ? FakeRecognition : undefined,
      active: () => active.value,
      synthesis: { speak: (u) => speeches.push(u), cancel },
      utterance: (text) => ({ text }) as SpeechSynthesisUtterance,
    },
    events,
  );
  return { controller, speeches, events, active, cancel };
}
afterEach(() => {
  vi.useRealTimers();
});
describe("persistent command lifecycle (mocked browser services)", () => {
  it("reports unsupported commands once, with narration disabled", async () => {
    const f = fixture(false);
    await f.controller.say("Welcome");
    f.controller.startListening();
    f.controller.startListening(false);
    expect(f.speeches).toHaveLength(0);
    expect(f.events.error).toHaveBeenCalledExactlyOnceWith("Voice commands aren't available in this browser. You can still use the controls on screen.");
  });
  it("restarts natural endings beyond four sessions and fifteen seconds", () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.startListening();
    for (let i = 0; i < 12; i++) {
      const rec = FakeRecognition.instances[i];
      rec.onend?.();
      expect(f.events.listening).toHaveBeenLastCalledWith(false);
      vi.advanceTimersByTime(249);
      expect(FakeRecognition.instances).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(FakeRecognition.instances).toHaveLength(i + 2);
    }
    vi.advanceTimersByTime(60000);
    expect(FakeRecognition.instances.at(-1)?.aborted).toBe(false);
    f.controller.stop();
  });
  it("recovers no-speech, but stops restarting when hidden or explicitly stopped", () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.startListening();
    FakeRecognition.instances[0].onerror?.({ error: "no-speech" });
    FakeRecognition.instances[0].onend?.();
    vi.advanceTimersByTime(250);
    expect(FakeRecognition.instances).toHaveLength(2);
    FakeRecognition.instances[1].onend?.();
    f.active.value = false;
    vi.advanceTimersByTime(10000);
    expect(FakeRecognition.instances).toHaveLength(2);
    f.controller.stop();
    f.active.value = true;
    vi.advanceTimersByTime(10000);
    expect(FakeRecognition.instances).toHaveLength(2);
  });
  it.each(["not-allowed", "service-not-allowed", "network", "audio-capture"])("never auto-retries %s, including after automatic mode requests", error => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.startListening();
    FakeRecognition.instances[0].onerror?.({ error });
    for (let i = 0; i < 8; i++) {
      f.controller.startListening(false);
      vi.advanceTimersByTime(10000);
    }
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(f.events.error).toHaveBeenCalledTimes(1);
    if (error.includes("allowed")) expect(f.events.error).toHaveBeenCalledWith("Microphone permission is needed for voice commands. Allow microphone access and try again.");
    f.controller.startListening();
    expect(FakeRecognition.instances).toHaveLength(2);
    f.controller.stop();
  });
  it("waits for asynchronous abort onend and command completion before starting another recognizer", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let finish!: () => void;
    f.events.command.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    f.controller.startListening();
    const rec = FakeRecognition.instances[0];
    rec.abort = () => { rec.aborted = true; }; // Real browsers end asynchronously.
    rec.result("Next");
    rec.result("Finish");
    f.controller.startListening(false);
    vi.advanceTimersByTime(1000);
    expect(FakeRecognition.instances).toHaveLength(1);
    rec.onend?.();
    vi.advanceTimersByTime(1000);
    expect(FakeRecognition.instances).toHaveLength(1);
    finish();
    await Promise.resolve();
    vi.advanceTimersByTime(250);
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(f.events.command).toHaveBeenCalledExactlyOnceWith("next");
    f.controller.stop();
  });
  it("only accepts final results, ignores unknown phrases without disabling intent, and resumes after commands", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.startListening();
    const rec = FakeRecognition.instances[0];
    rec.result("Finish", false);
    rec.result("I bought some soap");
    expect(f.events.command).not.toHaveBeenCalled();
    rec.result("finish checking");
    expect(f.events.command).toHaveBeenCalledExactlyOnceWith("finish");
    await Promise.resolve();
    vi.advanceTimersByTime(250);
    FakeRecognition.instances[1].result("repeat that");
    expect(f.events.command).toHaveBeenLastCalledWith("repeat");
    f.controller.stop();
  });
  it("keeps barge-in listening, blocks narration commands, clears queued speech and remains usable", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.startListening();
    const rec = FakeRecognition.instances[0];
    const spoken = f.controller.say("Product scanned successfully. Say Next or Finish.", 3, true);
    const queued = f.controller.say("Another message", 1, true);
    rec.result("Next");
    rec.result("Finish");
    rec.result("Repeat");
    rec.result("Start");
    expect(f.events.command).not.toHaveBeenCalled();
    expect(rec.aborted).toBe(false);
    rec.result("Stop speaking");
    await Promise.all([spoken, queued]);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.speeches).toHaveLength(1);
    expect(f.events.command).toHaveBeenCalledExactlyOnceWith("stop speaking");
    f.speeches[0].onend?.({} as SpeechSynthesisEvent); // Late synthesis callback.
    rec.result("Finish");
    expect(f.events.command).toHaveBeenLastCalledWith("finish");
    f.controller.stop();
  });
  it("Stop during narration cancels speech and recognition without restarting", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.startListening();
    const rec = FakeRecognition.instances[0];
    const done = f.controller.say("Long result", 3, true);
    rec.result("stop camera");
    await done;
    vi.advanceTimersByTime(60000);
    expect(f.cancel).toHaveBeenCalled();
    expect(rec.aborted).toBe(true);
    expect(f.events.command).toHaveBeenCalledExactlyOnceWith("stop");
    expect(FakeRecognition.instances).toHaveLength(1);
  });
  it("prioritizes and deduplicates speech, and reports speech failures", async () => {
    const f = fixture();
    f.controller.enabled = true;
    const low = f.controller.say("Reading", 0);
    await f.controller.say("Reading", 0);
    const high = f.controller.say("Unable to verify", 3);
    await low;
    expect(f.speeches).toHaveLength(2);
    f.speeches[1].onerror?.({} as SpeechSynthesisErrorEvent);
    await high;
    expect(f.events.error).toHaveBeenCalledWith(expect.stringContaining("displayed as text"));
    f.controller.stop();
  });
});

describe("explicit natural command aliases", () => {
  const aliases = {
    start: ["start", "start scanning", "start scan", "start checking", "start checking delivery", "begin", "begin scanning"],
    stop: ["stop", "stop scanning", "stop scanner", "stop camera", "stop checking"],
    "stop speaking": ["stop speaking", "stop talking", "be quiet", "silence"],
    repeat: ["repeat", "repeat that", "say that again", "repeat again"],
    next: ["next", "next product", "scan next", "scan next product", "continue", "continue scanning"],
    finish: ["finish", "finish checking", "finish checking delivery", "finish delivery", "done", "I'm done", "I am done", "that's all", "that is all", "complete checking"],
    retry: ["retry", "try again", "scan again"],
    help: ["help"], "read my orders": ["read my orders"], "read the result again": ["read the result again"],
    "go back": ["go back"], "yes another unit": ["yes another unit"], "no retry this unit": ["no retry this unit"],
  };
  for (const [command, phrases] of Object.entries(aliases)) it.each(phrases)(`maps %s to ${command}`, phrase => {
    expect(commandFrom(phrase)).toBe(command);
    expect(commandFrom(` Please, ${phrase.toUpperCase()}! `)).toBe(command);
  });
  it.each(["dont stop", "I will finish later", "the next product is soap", "start buying things", "stop speaking to me", "we are done shopping"])("rejects unrelated speech: %s", phrase => {
    expect(commandFrom(phrase)).toBeNull();
  });
});
