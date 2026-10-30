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
    command: vi.fn(),
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
describe("speech and command coordination (mocked services)", () => {
  it("defaults to no app TTS and reports unsupported recognition", async () => {
    const f = fixture(false);
    await f.controller.say("Welcome");
    expect(f.speeches).toHaveLength(0);
    f.controller.startListening();
    expect(f.events.error).toHaveBeenCalledWith(
      expect.stringContaining("unavailable"),
    );
    f.controller.stop();
  });
  it("accepts final phrases only and ends the explicit listening window", () => {
    const f = fixture();
    f.controller.startListening();
    const rec = FakeRecognition.instances[0];
    rec.result("stop", false);
    expect(f.events.command).not.toHaveBeenCalled();
    rec.result("Stop");
    expect(f.events.command).toHaveBeenCalledWith("stop");
    expect(rec.aborted).toBe(true);
    f.controller.stop();
  });
  it("pauses recognition during app speech and ignores stale self-speech callbacks", async () => {
    const f = fixture();
    f.controller.enabled = true;
    f.controller.startListening();
    const rec = FakeRecognition.instances[0],
      stale = rec.onresult;
    const done = f.controller.say("Next item");
    expect(rec.aborted).toBe(true);
    stale?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "Next" } }],
    });
    expect(f.events.command).not.toHaveBeenCalled();
    f.speeches[0].onstart?.({} as SpeechSynthesisEvent);
    expect(f.events.speaking).toHaveBeenLastCalledWith(true);
    f.speeches[0].onend?.({} as SpeechSynthesisEvent);
    await done;
    expect(FakeRecognition.instances).toHaveLength(2);
    f.controller.stop();
  });
  it("prioritizes results, deduplicates progress, and stops speech independently", async () => {
    const f = fixture();
    f.controller.enabled = true;
    const low = f.controller.say("Reading", 0);
    await f.controller.say("Reading", 0);
    expect(f.speeches).toHaveLength(1);
    const high = f.controller.say("Unable to verify", 3);
    await low;
    expect(f.cancel).toHaveBeenCalled();
    expect(f.speeches[1].text).toBe("Unable to verify");
    f.controller.cancelSpeech();
    await high;
    f.controller.stop();
  });
  it("bounds silence, does not restart on failure, and cancels on backgrounding", () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.startListening();
    vi.advanceTimersByTime(15001);
    expect(FakeRecognition.instances[0].aborted).toBe(true);
    f.controller.startListening();
    FakeRecognition.instances[1].onerror?.({ error: "not-allowed" });
    expect(f.events.error).toHaveBeenCalledWith(
      expect.stringContaining("not-allowed"),
    );
    vi.advanceTimersByTime(60000);
    expect(FakeRecognition.instances).toHaveLength(2);
    f.active.value = false;
    f.controller.startListening();
    expect(FakeRecognition.instances).toHaveLength(2);
    f.controller.stop();
  });
  it("recovers from unavailable speech and Stop cancels pending commands", async () => {
    const f = fixture();
    f.controller.enabled = true;
    const done = f.controller.say("Result");
    f.speeches[0].onerror?.({} as SpeechSynthesisErrorEvent);
    await done;
    expect(f.events.error).toHaveBeenCalledWith(
      expect.stringContaining("displayed as text"),
    );
    f.controller.startListening();
    const rec = FakeRecognition.instances[0];
    f.controller.stop();
    rec.result("Start");
    expect(f.events.command).not.toHaveBeenCalled();
  });
});
