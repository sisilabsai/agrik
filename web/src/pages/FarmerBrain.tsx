import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, getDeviceId, getToken, type VisionAnalysis } from "../lib/api";
import { Icon } from "../components/Visuals";
import { FarmerBrainMessageStream, FarmerBrainRealtimeModal } from "../components/FarmerBrainSections";
import { useAuth } from "../state/auth";

type AdviceCitation = {
  source_id?: string | null;
  title?: string | null;
  page?: string | null;
  file?: string | null;
  url?: string | null;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  message: string;
  created_at: string;
  language?: string;
  source_confidence?: number;
  citation_text?: string;
  citations?: AdviceCitation[];
  follow_ups?: string[];
  media_analysis?: VisionAnalysis;
};

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  messages: ChatMessage[];
};

type ProfileDetails = {
  user: { phone: string };
  settings: { district?: string | null; parish?: string | null; preferred_language?: string | null };
  farm: { crops: string[] };
};

type WeatherSummary = {
  location_name?: string | null;
  next_rain_date?: string | null;
  days: { date: string; precipitation_mm?: number | null; temp_max_c?: number | null; temp_min_c?: number | null }[];
};

type MarketPrediction = {
  crop: string;
  district?: string | null;
  predicted_price: number;
  currency: string;
  direction: "up" | "down" | "flat";
  confidence: number;
  horizon_days: number;
};

type MarketIntel = {
  predictions: MarketPrediction[];
};

type VisionModelOption = {
  id: string;
  label: string;
  tip: string;
};

type RealtimePhase = "idle" | "connecting" | "greeting" | "listening" | "waiting" | "speaking" | "paused";

const DEFAULT_VISION_MODEL_OPTIONS: VisionModelOption[] = [
  { id: "auto", label: "Auto (crop-aware)", tip: "Uses crop hint and confidence to pick the best model." },
  { id: "all", label: "Compare All", tip: "Runs multiple models and selects the strongest signal (slower)." },
  {
    id: "wambugu71/crop_leaf_diseases_vit",
    label: "wambugu71/crop_leaf_diseases_vit",
    tip: "Structured leaf disease classes and quick triage.",
  },
  {
    id: "prof-freakenstein/plantnet-disease-detection",
    label: "prof-freakenstein/plantnet-disease-detection",
    tip: "Broad plant disease coverage.",
  },
  {
    id: "IsmatS/crop_desease_detection",
    label: "IsmatS/crop_desease_detection",
    tip: "Useful as a second opinion model.",
  },
];

const starterPrompts = [
  "My maize leaves are yellow. Give immediate actions.",
  "My beans have leaf spots. Give immediate actions.",
  "Create a 7-day pest monitoring plan for my crop.",
  "How should I adapt this week based on weather?",
  "What should I monitor before harvest this week?",
];

const STORAGE_KEY_PREFIX = "agrik_grik_conversations";
const MAX_MEDIA_FILES = 6;
const VIDEO_FRAME_COUNT = 3;
const MAX_VIDEO_SECONDS = 5;
const MAX_RECORDING_SECONDS = 60;
const AUTO_RECORD_AND_SEND_SECONDS = 12;
const REALTIME_CHUNK_MS = 1100;
const REALTIME_SILENCE_COMMIT_MS = 1800;
const REALTIME_MIN_SPEECH_MS = 900;
const REALTIME_MAX_CAPTURE_MS = 12000;
const REALTIME_VAD_INTERVAL_MS = 180;
const REALTIME_SPEECH_THRESHOLD = 0.02;
const REALTIME_USER_MESSAGE_PREFIX = "[Realtime voice]";
const ENABLE_BROWSER_TTS_FALLBACK = true;
const VOICE_PROFILE_STORAGE_KEY_PREFIX = "agrik_grik_voice_profile";

type VoiceProfile = "auto" | "uganda" | "east_africa" | "neutral";

const VOICE_PROFILE_OPTIONS: { id: VoiceProfile; label: string; detail: string }[] = [
  { id: "uganda", label: "Ugandan", detail: "Prefers Uganda-accent voice mappings when configured." },
  { id: "east_africa", label: "East African", detail: "Prefers a broader East African accent profile." },
  { id: "neutral", label: "Neutral", detail: "Prefers a neutral global voice profile." },
  { id: "auto", label: "Auto", detail: "Lets backend choose voice profile from language and defaults." },
];

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function isVoiceProfile(value: string): value is VoiceProfile {
  return value === "auto" || value === "uganda" || value === "east_africa" || value === "neutral";
}

function resolveVoiceHint(profile: VoiceProfile): string {
  if (profile === "auto") return "auto";
  if (profile === "east_africa") return "east_africa";
  if (profile === "neutral") return "neutral";
  return "uganda";
}

function toWebSocketUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl || "http://localhost:8000";
  const url = new URL(path, normalizedBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x4000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function writeAsciiWav(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function audioBufferToWavBlob(audioBuffer: AudioBuffer): Blob {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;
  const bytesPerSample = 2;
  const dataSize = frameCount * bytesPerSample;
  const totalSize = 44 + dataSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  writeAsciiWav(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiWav(view, 8, "WAVE");
  writeAsciiWav(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAsciiWav(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index));
  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    let mixed = 0;
    for (let ch = 0; ch < channelCount; ch += 1) {
      mixed += channels[ch][i] ?? 0;
    }
    mixed /= channelCount;
    const clamped = Math.max(-1, Math.min(1, mixed));
    const sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(sample), true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function convertAudioBlobToWav(blob: Blob): Promise<Blob | null> {
  if (!blob.size) return null;
  const mimeType = (blob.type || "").toLowerCase();
  if (mimeType.includes("wav")) return blob;
  if (typeof window === "undefined") return null;

  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const audioContext = new AudioContextCtor();
  try {
    const source = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(source.slice(0));
    return audioBufferToWavBlob(decoded);
  } catch {
    return null;
  } finally {
    void audioContext.close().catch(() => {
      // ignore close errors
    });
  }
}

function guessAudioExtension(mimeType: string): string {
  const lower = (mimeType || "").toLowerCase();
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("mp4") || lower.includes("m4a")) return "m4a";
  if (lower.includes("flac")) return "flac";
  return "webm";
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString();
}

function formatCitation(citation: AdviceCitation): string {
  const base = citation.title || citation.source_id || "manual source";
  const page = citation.page ? `p.${citation.page}` : "";
  const file = citation.file ?? "";
  return [base, page, file].filter(Boolean).join(" | ");
}

function parseApiError(err: unknown): string {
  if (!err || typeof err !== "object") {
    return "GRIK is temporarily unavailable.";
  }
  const detail = (err as { detail?: string }).detail;
  if (detail && detail.trim()) {
    return `GRIK is temporarily unavailable: ${detail}`;
  }
  return "GRIK is temporarily unavailable.";
}

function resolveBrowserSpeechLang(localeHint?: string): string {
  const normalized = (localeHint || "").trim().toLowerCase();
  if (!normalized) return "en-US";
  if (normalized.startsWith("sw")) return "sw-KE";
  if (normalized.startsWith("lg")) return "lg-UG";
  if (normalized.startsWith("nyn")) return "nyn-UG";
  if (normalized.startsWith("ach")) return "ach-UG";
  if (normalized.startsWith("teo")) return "teo-UG";
  if (normalized.startsWith("en")) return "en-US";
  return "en-US";
}

function selectBrowserSpeechVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const loweredLang = lang.toLowerCase();
  const exact = voices.find((voice) => voice.lang.toLowerCase() === loweredLang);
  if (exact) return exact;

  const prefix = loweredLang.split("-")[0];
  const byPrefix = voices.find((voice) => {
    const voiceLang = voice.lang.toLowerCase();
    return voiceLang === prefix || voiceLang.startsWith(`${prefix}-`);
  });
  if (byPrefix) return byPrefix;

  const fallback = voices.find((voice) => voice.default);
  return fallback ?? voices[0] ?? null;
}

function createConversation(title = "New conversation"): Conversation {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    created_at: new Date().toISOString(),
    messages: [],
  };
}

function normalizeChatMessage(item: { id: number; role: string; message: string; created_at: string }): ChatMessage {
  return {
    id: item.id,
    role: item.role === "assistant" ? "assistant" : "user",
    message: item.message,
    created_at: item.created_at,
  };
}

function inferConversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser?.message) return "New conversation";
  const text = firstUser.message.trim();
  if (text.length <= 46) return text;
  return `${text.slice(0, 43).trim()}...`;
}

function buildConversationText(conversation: Conversation): string {
  const lines: string[] = [];
  lines.push(`Title: ${conversation.title}`);
  lines.push(`Created: ${conversation.created_at}`);
  lines.push("");

  for (const message of conversation.messages) {
    lines.push(`${message.role.toUpperCase()} [${message.created_at}]`);
    lines.push(message.message);
    lines.push("");
  }
  return lines.join("\n");
}

function downloadFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked") {
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to read uploaded video."));
    };
    const cleanup = () => {
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function extractFramesFromVideo(videoFile: File, frameCount: number, maxDurationSec: number): Promise<File[]> {
  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;

  try {
    await waitForVideoEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("Video duration could not be determined.");
    }
    if (video.duration > maxDurationSec) {
      throw new Error(`Video is too long (${video.duration.toFixed(1)}s). Maximum is ${maxDurationSec}s.`);
    }

    const width = Math.max(320, Math.min(1280, video.videoWidth || 0));
    const height = Math.max(180, Math.min(720, video.videoHeight || 0));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Browser does not support canvas frame extraction.");
    }

    const frames: File[] = [];
    for (let i = 0; i < frameCount; i += 1) {
      const ratio = (i + 1) / (frameCount + 1);
      const targetTime = Math.max(0.01, Math.min(video.duration - 0.01, video.duration * ratio));
      video.currentTime = targetTime;
      await waitForVideoEvent(video, "seeked");
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (!result) {
              reject(new Error("Failed to extract video frame."));
              return;
            }
            resolve(result);
          },
          "image/jpeg",
          0.9
        );
      });

      frames.push(
        new File([blob], `${videoFile.name.replace(/\.[^.]+$/, "")}-frame-${i + 1}.jpg`, {
          type: "image/jpeg",
        })
      );
    }

    return frames;
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.src = "";
  }
}

function formatMediaAttachmentLabel(photoCount: number, frameCount: number): string {
  const photoText = `${photoCount} photo${photoCount === 1 ? "" : "s"}`;
  const frameText = `${frameCount} video frame${frameCount === 1 ? "" : "s"}`;
  if (photoCount > 0 && frameCount > 0) {
    return `${photoText}, ${frameText}`;
  }
  if (photoCount > 0) {
    return photoText;
  }
  return frameText;
}

export default function FarmerBrain() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileDetails | null>(null);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [market, setMarket] = useState<MarketIntel | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [videoFrames, setVideoFrames] = useState<File[]>([]);
  const [videoFileName, setVideoFileName] = useState<string>("");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [visionModelOptions, setVisionModelOptions] = useState<VisionModelOption[]>(DEFAULT_VISION_MODEL_OPTIONS);
  const [visionCropOptions, setVisionCropOptions] = useState<string[]>([]);
  const [cropHint, setCropHint] = useState<string>("");
  const [modelPreference, setModelPreference] = useState<string>("auto");
  const [deepAnalysis, setDeepAnalysis] = useState(false);
  const [sttBusy, setSttBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [ttsBusyMessageId, setTtsBusyMessageId] = useState<number | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<number | null>(null);
  const [autoSpeakReplies, setAutoSpeakReplies] = useState(false);
  const [recordAndSendMode, setRecordAndSendMode] = useState(false);
  const [realtimeConnecting, setRealtimeConnecting] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [realtimeListening, setRealtimeListening] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [realtimePartialTranscript, setRealtimePartialTranscript] = useState<string>("");
  const [realtimeModalOpen, setRealtimeModalOpen] = useState(false);
  const [realtimePhase, setRealtimePhase] = useState<RealtimePhase>("idle");
  const [realtimeSpeechDetected, setRealtimeSpeechDetected] = useState(false);
  const [realtimeAudioLevel, setRealtimeAudioLevel] = useState(0);
  const [realtimeNeedsConversationChoice, setRealtimeNeedsConversationChoice] = useState(false);
  const [ttsVoiceProfile, setTtsVoiceProfile] = useState<VoiceProfile>("uganda");

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingTickerRef = useRef<number | null>(null);
  const recordingAutoSendRef = useRef(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const activePlaybackUrlRef = useRef<string | null>(null);
  const audioCacheRef = useRef<Map<number, string>>(new Map());
  const lastAssistantIdRef = useRef<number | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeChunksRef = useRef<Blob[]>([]);
  const realtimeCaptureMimeTypeRef = useRef<string>("audio/webm");
  const realtimeAssistantDraftIdRef = useRef<number | null>(null);
  const realtimeTtsBase64Ref = useRef<string>("");
  const realtimeLastAssistantSpeechRef = useRef<{ text: string; language?: string }>({ text: "" });
  const realtimeConnectedRef = useRef(false);
  const realtimeListeningRef = useRef(false);
  const realtimeModalOpenRef = useRef(false);
  const realtimeNeedsChoiceRef = useRef(false);
  const realtimePendingCommitRef = useRef(false);
  const realtimeAwaitingReplyRef = useRef(false);
  const realtimeAwaitingGreetingRef = useRef(false);
  const realtimeAudioContextRef = useRef<AudioContext | null>(null);
  const realtimeVadIntervalRef = useRef<number | null>(null);
  const realtimeLastSpeechTsRef = useRef<number>(0);
  const realtimeCaptureStartedAtRef = useRef<number>(0);
  const realtimeHasSpeechRef = useRef(false);
  const realtimeCaptureTimeoutRef = useRef<number | null>(null);
  const realtimeSpeechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const realtimeSpeechRecognitionEnabledRef = useRef(false);
  const browserSpeechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceProfileHydratedRef = useRef(false);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? conversations[0] ?? null,
    [activeConversationId, conversations]
  );
  const activeMessages = activeConversation?.messages ?? [];
  const attachedFileCount = selectedImages.length + videoFrames.length;
  const mediaAttachmentLabel = useMemo(
    () => formatMediaAttachmentLabel(selectedImages.length, videoFrames.length),
    [selectedImages.length, videoFrames.length]
  );
  const selectedImagePreviews = useMemo(
    () => selectedImages.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
    [selectedImages]
  );
  const videoFramePreviews = useMemo(
    () => videoFrames.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
    [videoFrames]
  );

  useEffect(() => {
    if (!user?.id) return;
    const storageKey = `${STORAGE_KEY_PREFIX}_${user.id}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { conversations?: Conversation[]; activeConversationId?: string };
      if (parsed?.conversations && parsed.conversations.length > 0) {
        setConversations(parsed.conversations);
        setActiveConversationId(parsed.activeConversationId || parsed.conversations[0].id);
      }
    } catch {
      // ignore invalid local data
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      voiceProfileHydratedRef.current = false;
      return;
    }
    const storageKey = `${VOICE_PROFILE_STORAGE_KEY_PREFIX}_${user.id}`;
    const raw = (localStorage.getItem(storageKey) || "").trim().toLowerCase();
    if (isVoiceProfile(raw)) {
      setTtsVoiceProfile(raw);
    }
    voiceProfileHydratedRef.current = true;
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || conversations.length === 0) return;
    const storageKey = `${STORAGE_KEY_PREFIX}_${user.id}`;
    localStorage.setItem(storageKey, JSON.stringify({ conversations, activeConversationId }));
  }, [activeConversationId, conversations, user?.id]);

  useEffect(() => {
    if (!user?.id || !voiceProfileHydratedRef.current) return;
    const storageKey = `${VOICE_PROFILE_STORAGE_KEY_PREFIX}_${user.id}`;
    localStorage.setItem(storageKey, ttsVoiceProfile);
  }, [ttsVoiceProfile, user?.id]);

  useEffect(() => {
    if (conversations.length === 0) {
      api
        .chatHistory(80)
        .then((res) => {
          const historyMessages = (res.items ?? []).map(normalizeChatMessage);
          const initial = createConversation("Conversation history");
          const conversation: Conversation = {
            ...initial,
            title: historyMessages.length ? inferConversationTitle(historyMessages) : "Conversation history",
            messages: historyMessages,
          };
          setConversations([conversation]);
          setActiveConversationId(conversation.id);
        })
        .catch(() => {
          const emptyConversation = createConversation();
          setConversations([emptyConversation]);
          setActiveConversationId(emptyConversation.id);
        });
    }
  }, [conversations.length]);

  useEffect(() => {
    let active = true;

    async function loadContext() {
      setContextLoading(true);
      setContextError(null);
      try {
        const profileRes = (await api.profileDetails()) as ProfileDetails;
        if (!active) return;
        setProfile(profileRes);

        const district = profileRes.settings.district ?? "";
        const marketQuery = district ? `?district=${encodeURIComponent(district)}&limit=6` : "?limit=6";
        const [weatherRes, marketRes, visionRes] = await Promise.all([
          api.weatherSummary().catch(() => null),
          api.marketIntel(marketQuery).catch(() => null),
          api.visionOptions().catch(() => null),
        ]);
        if (!active) return;
        setWeather((weatherRes as WeatherSummary | null) ?? null);
        setMarket((marketRes as MarketIntel | null) ?? null);
        const visionPayload = visionRes as { models?: VisionModelOption[]; crops?: string[] } | null;
        if (visionPayload?.models && visionPayload.models.length > 0) {
          setVisionModelOptions(visionPayload.models);
        }
        if (visionPayload?.crops) {
          setVisionCropOptions(visionPayload.crops);
        }
      } catch {
        if (!active) return;
        setProfile(null);
        setWeather(null);
        setMarket(null);
        setContextError("Unable to load farmer context. GRIK will still answer your question.");
      } finally {
        if (active) setContextLoading(false);
      }
    }

    void loadContext();
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages, sending]);

  useEffect(() => {
    return () => {
      for (const preview of selectedImagePreviews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [selectedImagePreviews]);

  useEffect(() => {
    return () => {
      for (const preview of videoFramePreviews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [videoFramePreviews]);

  useEffect(() => {
    return () => {
      stopRecordingTimers();
      stopRecordingStream();
      stopAudioPlayback();
      disconnectRealtimeSession();
      for (const objectUrl of audioCacheRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      audioCacheRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const localeHint = profile?.settings.preferred_language?.trim() || undefined;
  const locationHint = useMemo(
    () =>
      [profile?.settings.parish, profile?.settings.district]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(", ") || undefined,
    [profile?.settings.district, profile?.settings.parish]
  );

  const topPrediction = market?.predictions?.[0];
  const cropOptions = useMemo(() => {
    const profileCrops = (profile?.farm.crops ?? []).map((item) => item.trim()).filter(Boolean);
    const fromVision = visionCropOptions.map((item) => item.trim()).filter(Boolean);
    return Array.from(new Set([...profileCrops, ...fromVision]));
  }, [profile?.farm.crops, visionCropOptions]);
  const selectedModelTip = useMemo(() => {
    const found = visionModelOptions.find((item) => item.id === modelPreference);
    return found?.tip || "Model controls let you constrain or compare vision engines.";
  }, [modelPreference, visionModelOptions]);
  const selectedVoiceProfile = useMemo(
    () => VOICE_PROFILE_OPTIONS.find((option) => option.id === ttsVoiceProfile) ?? VOICE_PROFILE_OPTIONS[0],
    [ttsVoiceProfile]
  );
  const realtimePhaseLabel = useMemo(() => {
    if (realtimePhase === "listening" && realtimeSpeechDetected) return "Speaking";
    if (realtimePhase === "listening") return "Listening";
    if (realtimePhase === "waiting") return "Waiting for GRIK";
    if (realtimePhase === "speaking") return "GRIK speaking";
    if (realtimePhase === "greeting") return "Welcoming";
    if (realtimePhase === "connecting") return "Connecting";
    if (realtimePhase === "paused") return "Paused";
    return "Offline";
  }, [realtimePhase, realtimeSpeechDetected]);
  const realtimeAssistantCue = useMemo(() => {
    if (realtimeStatus) return realtimeStatus;
    if (realtimePhase === "waiting") return "Thinking through your context and preparing a response.";
    if (realtimePhase === "speaking") return "Delivering response...";
    if (realtimePhase === "greeting") return "Welcoming you to live voice mode.";
    if (realtimePhase === "listening") return "Listening to you now.";
    return realtimeConnected ? "Ready for your next question." : "Connecting to live voice.";
  }, [realtimeConnected, realtimePhase, realtimeStatus]);
  const realtimePrimaryActionLabel = useMemo(() => {
    if (realtimeListening) return "Pause and send";
    if (realtimeNeedsConversationChoice) return "Speak after selection";
    if (realtimeConnected) return "Speak now";
    return "Connect voice";
  }, [realtimeConnected, realtimeListening, realtimeNeedsConversationChoice]);
  const realtimeRecentAssistantText = useMemo(() => {
    const latest = [...activeMessages].reverse().find((message) => message.role === "assistant");
    return latest?.message?.trim() || "";
  }, [activeMessages]);
  const realtimeSessionFacts = useMemo(
    () =>
      [
        locationHint ? `Location: ${locationHint}` : "Location not set",
        localeHint ? `Language: ${localeHint}` : "Language auto",
        `Voice: ${selectedVoiceProfile.label}`,
      ].slice(0, 3),
    [localeHint, locationHint, selectedVoiceProfile.label]
  );

  const latestAssistantFollowUps = useMemo(() => {
    const latest = [...activeMessages].reverse().find((msg) => msg.role === "assistant" && msg.follow_ups && msg.follow_ups.length > 0);
    return latest?.follow_ups ?? [];
  }, [activeMessages]);

  const promptSuggestions = useMemo(() => {
    const farmPrompts = (profile?.farm.crops ?? []).slice(0, 2).map((crop) => `Give me a weekly protection checklist for ${crop}.`);
    const followUps = latestAssistantFollowUps.slice(0, 3);
    if (followUps.length > 0) {
      return Array.from(new Set([...followUps, ...farmPrompts])).slice(0, 8);
    }
    return Array.from(new Set([...farmPrompts, ...starterPrompts])).slice(0, 8);
  }, [latestAssistantFollowUps, profile?.farm.crops]);
  const assistantMessageCount = useMemo(
    () => activeMessages.filter((message) => message.role === "assistant").length,
    [activeMessages]
  );
  const groundedMessageCount = useMemo(
    () => activeMessages.filter((message) => message.role === "assistant" && (message.citations?.length ?? 0) > 0).length,
    [activeMessages]
  );
  const mediaMessageCount = useMemo(
    () => activeMessages.filter((message) => Boolean(message.media_analysis)).length,
    [activeMessages]
  );
  const contextCoverageCount = [
    Boolean(locationHint || weather?.location_name),
    Boolean((profile?.farm.crops ?? []).length),
    Boolean(weather?.days?.length),
    Boolean(topPrediction),
  ].filter(Boolean).length;
  const liveVoiceStateLabel = realtimeConnected ? (realtimeListening ? "Listening now" : "Ready") : "Offline";
  const compactStatusItems = [
    contextError ? { tone: "error", message: contextError } : null,
    error ? { tone: "error", message: error } : null,
    statusNote ? { tone: "info", message: statusNote } : null,
    !realtimeModalOpen && realtimeError ? { tone: "error", message: realtimeError } : null,
    !realtimeModalOpen && realtimeStatus ? { tone: "info", message: realtimeStatus } : null,
  ].filter((item): item is { tone: "error" | "info"; message: string } => Boolean(item));

  useEffect(() => {
    const latestAssistant = [...activeMessages].reverse().find((item) => item.role === "assistant");
    if (!latestAssistant) {
      lastAssistantIdRef.current = null;
      return;
    }
    if (lastAssistantIdRef.current == null) {
      lastAssistantIdRef.current = latestAssistant.id;
      return;
    }
    if (latestAssistant.id !== lastAssistantIdRef.current && autoSpeakReplies) {
      void playAssistantAudio(latestAssistant);
    }
    lastAssistantIdRef.current = latestAssistant.id;
  }, [activeMessages, autoSpeakReplies]);

  useEffect(() => {
    stopAudioPlayback();
    setAudioStatus(null);
    lastAssistantIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  useEffect(() => {
    const socket = realtimeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "session.update",
        locale_hint: localeHint,
        location_hint: locationHint,
        voice_hint: resolveVoiceHint(ttsVoiceProfile),
      })
    );
  }, [localeHint, locationHint, ttsVoiceProfile]);

  useEffect(() => {
    realtimeConnectedRef.current = realtimeConnected;
  }, [realtimeConnected]);

  useEffect(() => {
    realtimeListeningRef.current = realtimeListening;
  }, [realtimeListening]);

  useEffect(() => {
    realtimeModalOpenRef.current = realtimeModalOpen;
  }, [realtimeModalOpen]);

  useEffect(() => {
    realtimeNeedsChoiceRef.current = realtimeNeedsConversationChoice;
  }, [realtimeNeedsConversationChoice]);

  const setConversationMessages = (conversationId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => {
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const nextMessages = updater(conversation.messages);
        return {
          ...conversation,
          messages: nextMessages,
          title: inferConversationTitle(nextMessages),
        };
      })
    );
  };

  const appendRealtimeUserTranscript = (transcript: string) => {
    const cleaned = transcript.trim();
    if (!cleaned) return;
    const conversationId = ensureActiveConversation();
    const messageId = Date.now() + Math.floor(Math.random() * 1000);
    setConversationMessages(conversationId, (messages) => [
      ...messages,
      {
        id: messageId,
        role: "user",
        message: `${REALTIME_USER_MESSAGE_PREFIX} ${cleaned}`,
        created_at: new Date().toISOString(),
      },
    ]);
  };

  const appendRealtimeAssistantDelta = (delta: string) => {
    if (!delta) return;
    const conversationId = ensureActiveConversation();
    const existingId = realtimeAssistantDraftIdRef.current;
    if (existingId == null) {
      const draftId = Date.now() + Math.floor(Math.random() * 1000) + 2000;
      realtimeAssistantDraftIdRef.current = draftId;
      setConversationMessages(conversationId, (messages) => [
        ...messages,
        {
          id: draftId,
          role: "assistant",
          message: delta,
          created_at: new Date().toISOString(),
        },
      ]);
      return;
    }

    setConversationMessages(conversationId, (messages) =>
      messages.map((item) => {
        if (item.id !== existingId) return item;
        return {
          ...item,
          message: `${item.message}${delta}`,
          created_at: new Date().toISOString(),
        };
      })
    );
  };

  const finalizeRealtimeAssistantMessage = (payload: {
    text: string;
    language?: string;
    source_confidence?: number;
    citations?: AdviceCitation[];
  }) => {
    const cleaned = (payload.text || "").trim();
    if (!cleaned) return;
    const conversationId = ensureActiveConversation();
    const existingId = realtimeAssistantDraftIdRef.current;
    if (existingId == null) {
      const id = Date.now() + Math.floor(Math.random() * 1000) + 3000;
      setConversationMessages(conversationId, (messages) => [
        ...messages,
        {
          id,
          role: "assistant",
          message: cleaned,
          created_at: new Date().toISOString(),
          language: payload.language,
          source_confidence: payload.source_confidence,
          citations: payload.citations,
        },
      ]);
      return;
    }
    setConversationMessages(conversationId, (messages) =>
      messages.map((item) => {
        if (item.id !== existingId) return item;
        return {
          ...item,
          message: cleaned,
          created_at: new Date().toISOString(),
          language: payload.language,
          source_confidence: payload.source_confidence,
          citations: payload.citations,
        };
      })
    );
    realtimeAssistantDraftIdRef.current = null;
  };

  const teardownRealtimeVad = () => {
    if (realtimeVadIntervalRef.current != null) {
      window.clearInterval(realtimeVadIntervalRef.current);
      realtimeVadIntervalRef.current = null;
    }
    if (realtimeCaptureTimeoutRef.current != null) {
      window.clearTimeout(realtimeCaptureTimeoutRef.current);
      realtimeCaptureTimeoutRef.current = null;
    }
    const audioContext = realtimeAudioContextRef.current;
    realtimeAudioContextRef.current = null;
    if (audioContext) {
      void audioContext.close().catch(() => {
        // ignore close errors
      });
    }
    realtimeHasSpeechRef.current = false;
    setRealtimeSpeechDetected(false);
    setRealtimeAudioLevel(0);
  };

  const stopRealtimeSpeechRecognition = () => {
    const recognition = realtimeSpeechRecognitionRef.current;
    realtimeSpeechRecognitionRef.current = null;
    realtimeSpeechRecognitionEnabledRef.current = false;
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    } catch {
      // ignore
    }
  };

  const startRealtimeSpeechRecognition = () => {
    if (typeof window === "undefined") return;
    const ctor = (
      (window as typeof window & { SpeechRecognition?: BrowserSpeechRecognitionCtor }).SpeechRecognition ||
      (window as typeof window & { webkitSpeechRecognition?: BrowserSpeechRecognitionCtor }).webkitSpeechRecognition
    ) as BrowserSpeechRecognitionCtor | undefined;
    if (!ctor) return;

    let recognition = realtimeSpeechRecognitionRef.current;
    if (!recognition) {
      recognition = new ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      realtimeSpeechRecognitionRef.current = recognition;
    }

    recognition.lang = resolveBrowserSpeechLang(localeHint);
    recognition.onresult = (event: any) => {
      const results = event?.results;
      if (!results || typeof results.length !== "number") return;
      const parts: string[] = [];
      for (let i = 0; i < results.length; i += 1) {
        const transcript = String(results[i]?.[0]?.transcript || "").trim();
        if (transcript) {
          parts.push(transcript);
        }
      }
      const partial = parts.join(" ").trim();
      if (partial) {
        setRealtimePartialTranscript(partial);
      }
    };
    recognition.onerror = () => {
      realtimeSpeechRecognitionEnabledRef.current = false;
    };
    recognition.onend = () => {
      realtimeSpeechRecognitionEnabledRef.current = false;
      if (!realtimeListeningRef.current || !realtimeModalOpenRef.current || realtimeAwaitingReplyRef.current) return;
      window.setTimeout(() => {
        if (!realtimeListeningRef.current || !realtimeModalOpenRef.current || realtimeAwaitingReplyRef.current) return;
        startRealtimeSpeechRecognition();
      }, 120);
    };

    if (realtimeSpeechRecognitionEnabledRef.current) return;
    try {
      recognition.start();
      realtimeSpeechRecognitionEnabledRef.current = true;
    } catch {
      // ignore duplicate start errors
    }
  };

  const sendRealtimeCommit = async () => {
    if (!realtimePendingCommitRef.current) return;
    realtimePendingCommitRef.current = false;
    const socket = realtimeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      realtimeAwaitingReplyRef.current = false;
      return;
    }

    const captureMimeType = realtimeCaptureMimeTypeRef.current || "audio/webm";
    const chunks = realtimeChunksRef.current;
    realtimeChunksRef.current = [];
    const rawBlob = new Blob(chunks, { type: captureMimeType });
    if (!rawBlob.size) {
      realtimeAwaitingReplyRef.current = false;
      setRealtimePhase("paused");
      setRealtimeStatus("No speech captured. Speak again.");
      if (realtimeConnectedRef.current && realtimeModalOpenRef.current) {
        void startRealtimeCapture();
      }
      return;
    }

    try {
      const wavBlob = await convertAudioBlobToWav(rawBlob);
      if (!wavBlob || !wavBlob.size) {
        realtimeAwaitingReplyRef.current = false;
        setRealtimeError("Realtime STT requires WAV audio conversion, and this browser could not convert the recording.");
        setRealtimePhase("paused");
        setRealtimeStatus("Realtime audio format unsupported here. Use Chrome or Edge.");
        return;
      }
      const payloadBase64 = await blobToBase64(wavBlob);
      socket.send(
        JSON.stringify({
          type: "audio.chunk",
          audio: payloadBase64,
          mime_type: "audio/wav",
        })
      );
      realtimeAwaitingReplyRef.current = true;
      setRealtimePhase("waiting");
      setRealtimeStatus("Pause detected. Waiting for GRIK response...");
      socket.send(JSON.stringify({ type: "audio.commit" }));
    } catch {
      realtimeAwaitingReplyRef.current = false;
      setRealtimePhase("paused");
      setRealtimeStatus("Realtime audio processing failed. Speak again.");
      if (realtimeConnectedRef.current && realtimeModalOpenRef.current) {
        void startRealtimeCapture();
      }
    }
  };

  const clearActivePlaybackUrl = () => {
    const activeUrl = activePlaybackUrlRef.current;
    if (!activeUrl) return;
    URL.revokeObjectURL(activeUrl);
    activePlaybackUrlRef.current = null;
  };

  const playAudioBlob = async (
    blob: Blob,
    options?: {
      statusText?: string;
      phase?: RealtimePhase;
      onEnded?: () => void;
    }
  ) => {
    const objectUrl = URL.createObjectURL(blob);
    stopAudioPlayback();
    activePlaybackUrlRef.current = objectUrl;
    setAudioError(null);

    let player = audioPlayerRef.current;
    if (!player) {
      player = new Audio();
      audioPlayerRef.current = player;
    }
    player.src = objectUrl;
    player.onended = () => {
      setAudioStatus(null);
      if (activePlaybackUrlRef.current === objectUrl) {
        clearActivePlaybackUrl();
      }
      options?.onEnded?.();
    };
    player.onerror = () => {
      setAudioStatus(null);
      setAudioError("This device could not play the live voice reply. Read the text response or try again.");
      if (activePlaybackUrlRef.current === objectUrl) {
        clearActivePlaybackUrl();
      }
      options?.onEnded?.();
    };
    setRealtimePhase(options?.phase ?? "speaking");
    setAudioStatus(options?.statusText ?? "Playing realtime GRIK response...");
    await player.play();
  };

  const speakWithBrowserSpeech = (
    text: string,
    options?: {
      localeHint?: string;
      statusText?: string;
      phase?: RealtimePhase;
      onStart?: () => void;
      onEnded?: () => void;
      onError?: () => void;
    }
  ): boolean => {
    const spokenText = text.trim();
    if (!spokenText || typeof window === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      return false;
    }
    const synth = window.speechSynthesis;
    if (!synth) {
      return false;
    }

    try {
      stopAudioPlayback();
      setAudioError(null);
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(spokenText);
      browserSpeechUtteranceRef.current = utterance;
      const lang = resolveBrowserSpeechLang(options?.localeHint || localeHint);
      utterance.lang = lang;
      const selectedVoice = selectBrowserSpeechVoice(synth.getVoices(), lang);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.onstart = () => {
        options?.onStart?.();
      };
      utterance.onend = () => {
        browserSpeechUtteranceRef.current = null;
        options?.onEnded?.();
      };
      utterance.onerror = () => {
        browserSpeechUtteranceRef.current = null;
        options?.onError?.();
      };

      if (options?.phase) {
        setRealtimePhase(options.phase);
      }
      if (options?.statusText) {
        setAudioStatus(options.statusText);
      }

      synth.speak(utterance);
      return true;
    } catch {
      browserSpeechUtteranceRef.current = null;
      return false;
    }
  };

  const resumeRealtimeAfterSpeech = () => {
    realtimeAwaitingReplyRef.current = false;
    if (!realtimeConnectedRef.current || !realtimeModalOpenRef.current || realtimeNeedsChoiceRef.current) {
      setRealtimePhase(realtimeConnectedRef.current ? "paused" : "idle");
      return;
    }
    setRealtimeStatus("Your turn. Speak now.");
    void startRealtimeCapture();
  };

  const playBase64Audio = async (base64Audio: string, mimeType: string) => {
    if (!base64Audio) return;
    try {
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType || "audio/wav" });
      await playAudioBlob(blob, {
        statusText: "GRIK is speaking...",
        phase: "speaking",
        onEnded: resumeRealtimeAfterSpeech,
      });
    } catch {
      setAudioError("Live voice reply could not be prepared for playback. Read the text response and continue.");
      setRealtimePhase("paused");
    }
  };

  const speakRealtimeWelcome = async (text: string, hasHistory: boolean) => {
    const welcomeText = text.trim();
    if (!welcomeText) {
      if (hasHistory) {
        realtimeNeedsChoiceRef.current = true;
        setRealtimeNeedsConversationChoice(true);
        setRealtimePhase("paused");
        setRealtimeStatus("Continue previous conversation or start a new one.");
      } else {
        realtimeNeedsChoiceRef.current = false;
        setRealtimeNeedsConversationChoice(false);
        setRealtimeStatus("Live session ready. Speak now.");
        void startRealtimeCapture();
      }
      return;
    }
    setRealtimePhase("greeting");
    setRealtimeStatus("GRIK is welcoming you...");
    try {
      const result = await api.chatSynthesizeAudio({
        text: welcomeText,
        locale_hint: localeHint,
        voice_hint: resolveVoiceHint(ttsVoiceProfile),
      });
      const blob =
        result.blob.type && result.blob.type !== "application/octet-stream"
          ? result.blob
          : new Blob([result.blob], { type: result.contentType || "audio/wav" });
      await playAudioBlob(blob, {
        statusText: "GRIK is speaking...",
        phase: "greeting",
      });
    } catch (err) {
      if (ENABLE_BROWSER_TTS_FALLBACK) {
        const fallbackSpoken = speakWithBrowserSpeech(welcomeText, {
          localeHint: localeHint,
          statusText: "GRIK is speaking...",
          phase: "greeting",
        });
        if (fallbackSpoken) {
          setRealtimeStatus("Server TTS unavailable. Using browser voice.");
        } else {
          setAudioError(parseApiError(err));
        }
      } else {
        setAudioError(parseApiError(err));
      }
    } finally {
      if (!realtimeConnectedRef.current) {
        setRealtimePhase("idle");
        return;
      }
      if (hasHistory) {
        realtimeNeedsChoiceRef.current = true;
        setRealtimeNeedsConversationChoice(true);
        setRealtimePhase("paused");
        setRealtimeStatus("History found. Speak to continue, or tap Start New.");
        void startRealtimeCapture();
        return;
      }
      realtimeNeedsChoiceRef.current = false;
      setRealtimeNeedsConversationChoice(false);
      setRealtimeStatus("Live session ready. Speak now.");
      void startRealtimeCapture();
    }
  };

  const stopRealtimeCapture = (sendCommit = true) => {
    const recorder = realtimeMediaRecorderRef.current;
    realtimePendingCommitRef.current = Boolean(sendCommit);
    stopRealtimeSpeechRecognition();

    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.requestData();
      } catch {
        // ignore requestData errors
      }
      recorder.stop();
    } else {
      realtimeMediaRecorderRef.current = null;
      if (sendCommit) {
        void sendRealtimeCommit();
      }
    }

    if (realtimeStreamRef.current) {
      for (const track of realtimeStreamRef.current.getTracks()) {
        track.stop();
      }
      realtimeStreamRef.current = null;
    }
    teardownRealtimeVad();
    realtimeListeningRef.current = false;
    setRealtimeListening(false);

    if (!sendCommit && realtimeConnectedRef.current) {
      realtimeAwaitingReplyRef.current = false;
      setRealtimePhase("paused");
      setRealtimeStatus("Realtime microphone paused.");
    }
  };

  const disconnectRealtimeSession = () => {
    stopRealtimeCapture(false);
    const socket = realtimeSocketRef.current;
    realtimeSocketRef.current = null;
    realtimePendingCommitRef.current = false;
    realtimeAwaitingReplyRef.current = false;
    realtimeAwaitingGreetingRef.current = false;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "session.stop" }));
      socket.close();
    } else if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
    realtimeAssistantDraftIdRef.current = null;
    realtimeTtsBase64Ref.current = "";
    realtimeLastAssistantSpeechRef.current = { text: "" };
    realtimeChunksRef.current = [];
    realtimeCaptureMimeTypeRef.current = "audio/webm";
    realtimeConnectedRef.current = false;
    setRealtimeConnected(false);
    setRealtimeConnecting(false);
    realtimeListeningRef.current = false;
    setRealtimeListening(false);
    setRealtimePartialTranscript("");
    realtimeNeedsChoiceRef.current = false;
    setRealtimeNeedsConversationChoice(false);
    setRealtimePhase("idle");
    setRealtimeStatus(null);
    setRealtimeError(null);
  };

  const handleRealtimeSocketMessage = (raw: MessageEvent<string>) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw.data);
    } catch {
      return;
    }

    const eventType = String(payload.type || "").toLowerCase();
    if (!eventType) return;

    if (eventType === "session.ready") {
      const hasHistory = Boolean(payload.has_history);
      const welcomeText = String(payload.welcome_text || "");
      realtimeLastAssistantSpeechRef.current = { text: "" };
      realtimeConnectedRef.current = true;
      setRealtimeConnected(true);
      setRealtimeConnecting(false);
      realtimeNeedsChoiceRef.current = hasHistory;
      setRealtimeNeedsConversationChoice(hasHistory);
      setRealtimePhase("paused");
      setRealtimeStatus("Realtime session connected.");
      setRealtimeError(null);
      if (realtimeAwaitingGreetingRef.current || realtimeModalOpenRef.current) {
        realtimeAwaitingGreetingRef.current = false;
        void speakRealtimeWelcome(welcomeText, hasHistory);
      }
      return;
    }
    if (eventType === "session.updated") {
      setRealtimeStatus("Realtime session updated.");
      return;
    }
    if (eventType === "session.mode") {
      const mode = String(payload.mode || "").toLowerCase();
      const modeMessage = String(payload.message || "").trim();
      if (mode === "new") {
        handleNewConversation();
      }
      realtimeNeedsChoiceRef.current = false;
      setRealtimeNeedsConversationChoice(false);
      if (modeMessage) {
        setRealtimeStatus(modeMessage);
      } else if (mode === "new") {
        setRealtimeStatus("Fresh conversation started.");
      } else if (mode === "continue") {
        setRealtimeStatus("Continuing with previous context.");
      }
      return;
    }
    if (eventType === "stt.partial") {
      const text = String(payload.text || "");
      if (text.trim()) {
        setRealtimePartialTranscript(text);
      }
      return;
    }
    if (eventType === "stt.processing") {
      setRealtimePhase("waiting");
      setRealtimeStatus("Realtime STT processing...");
      return;
    }
    if (eventType === "stt.final") {
      const text = String(payload.text || "");
      setRealtimePartialTranscript(text);
      appendRealtimeUserTranscript(text);
      setRealtimePhase("waiting");
      setRealtimeStatus("Realtime transcript captured.");
      return;
    }
    if (eventType === "assistant.text.delta") {
      setRealtimePhase("waiting");
      appendRealtimeAssistantDelta(String(payload.delta || ""));
      return;
    }
    if (eventType === "assistant.text.final") {
      const citationsRaw = payload.citations;
      const citations = Array.isArray(citationsRaw)
        ? (citationsRaw as AdviceCitation[])
        : undefined;
      const assistantText = String(payload.text || "");
      const assistantLanguage = String(payload.language || "") || undefined;
      realtimeLastAssistantSpeechRef.current = {
        text: assistantText,
        language: assistantLanguage,
      };
      finalizeRealtimeAssistantMessage({
        text: assistantText,
        language: assistantLanguage,
        source_confidence:
          typeof payload.source_confidence === "number"
            ? payload.source_confidence
            : undefined,
        citations,
      });
      setRealtimePhase("waiting");
      setRealtimeStatus("Realtime response ready.");
      return;
    }
    if (eventType === "tts.audio.chunk") {
      const chunk = String(payload.audio || "");
      if (!chunk) return;
      realtimeTtsBase64Ref.current += chunk;
      const isLast = Boolean(payload.is_last);
      if (isLast) {
        const mimeType = String(payload.mime_type || "audio/wav");
        const combined = realtimeTtsBase64Ref.current;
        realtimeTtsBase64Ref.current = "";
        void playBase64Audio(combined, mimeType);
      }
      return;
    }
    if (eventType === "tts.audio.end") {
      setRealtimeStatus("Realtime TTS generated.");
      return;
    }
    if (eventType === "error") {
      const detail = String(payload.detail || "Realtime voice error.");
      const stage = String(payload.stage || "").toLowerCase();
      const loweredDetail = detail.toLowerCase();
      const recoverableCaptureError =
        stage === "audio.commit" ||
        (stage === "stt" &&
          (loweredDetail.includes("no transcript") ||
            loweredDetail.includes("no speech") ||
            loweredDetail.includes("empty audio") ||
            loweredDetail.includes("empty audio chunk")));
      if (recoverableCaptureError && realtimeConnectedRef.current && realtimeModalOpenRef.current) {
        setRealtimeError(null);
        setRealtimePhase("paused");
        setRealtimeStatus("I did not catch that. Speak again.");
        void startRealtimeCapture();
        return;
      }
      if (stage === "tts") {
        if (ENABLE_BROWSER_TTS_FALLBACK) {
          const fallbackSpoken = speakWithBrowserSpeech(realtimeLastAssistantSpeechRef.current.text, {
            localeHint: realtimeLastAssistantSpeechRef.current.language || localeHint,
            statusText: "GRIK is speaking...",
            phase: "speaking",
            onEnded: resumeRealtimeAfterSpeech,
          });
          if (fallbackSpoken) {
            setRealtimeError(null);
            setRealtimeStatus("Server TTS unavailable. Using browser voice.");
            return;
          }
        } else {
          setRealtimeError(null);
          setRealtimeStatus("Voice response unavailable for this turn. Continue speaking.");
          resumeRealtimeAfterSpeech();
          return;
        }
      }
      setRealtimeError(detail);
      setRealtimePhase("paused");
      setRealtimeStatus("Realtime session paused after an error.");
      realtimeAwaitingReplyRef.current = false;
    }
  };

  const connectRealtimeSession = async (): Promise<boolean> => {
    if (realtimeSocketRef.current?.readyState === WebSocket.OPEN) {
      realtimeConnectedRef.current = true;
      setRealtimeConnected(true);
      setRealtimeConnecting(false);
      setRealtimePhase(realtimeListeningRef.current ? "listening" : "paused");
      return true;
    }
    if (realtimeSocketRef.current?.readyState === WebSocket.CONNECTING) {
      setRealtimeStatus("Connecting to realtime voice...");
      return false;
    }
    const token = getToken();
    if (!token) {
      setRealtimeError("Realtime voice requires login token.");
      return false;
    }

    const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
    const wsUrl = toWebSocketUrl(baseUrl, "/chat/realtime-voice");
    setRealtimeConnecting(true);
    setRealtimePhase("connecting");
    setRealtimeError(null);

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const deviceId = getDeviceId();
      const socket = new WebSocket(
        `${wsUrl}?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(deviceId)}`
      );
      const connectTimeout = window.setTimeout(() => {
        if (!settled && socket.readyState !== WebSocket.OPEN) {
          try {
            socket.close();
          } catch {
            // ignore
          }
          setRealtimeError("Realtime voice connection timed out.");
          setRealtimeConnecting(false);
          setRealtimePhase("idle");
          realtimeAwaitingGreetingRef.current = false;
          settled = true;
          resolve(false);
        }
      }, 8000);
      realtimeSocketRef.current = socket;

      socket.onopen = () => {
        if (realtimeSocketRef.current !== socket) {
          try {
            socket.close();
          } catch {
            // ignore
          }
          if (!settled) {
            settled = true;
            resolve(false);
          }
          return;
        }
        window.clearTimeout(connectTimeout);
        socket.send(
          JSON.stringify({
            type: "session.update",
            locale_hint: localeHint,
            location_hint: locationHint,
            voice_hint: resolveVoiceHint(ttsVoiceProfile),
          })
        );
        if (!settled) {
          settled = true;
          resolve(true);
        }
      };
      socket.onmessage = (event) => {
        if (realtimeSocketRef.current !== socket) return;
        handleRealtimeSocketMessage(event as MessageEvent<string>);
      };
      socket.onerror = () => {
        if (realtimeSocketRef.current !== socket) return;
        window.clearTimeout(connectTimeout);
        setRealtimeError("Realtime voice connection error.");
        setRealtimeConnecting(false);
        setRealtimePhase("idle");
        realtimeAwaitingGreetingRef.current = false;
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };
      socket.onclose = () => {
        if (realtimeSocketRef.current !== socket) return;
        window.clearTimeout(connectTimeout);
        stopRealtimeSpeechRecognition();
        teardownRealtimeVad();
        realtimeChunksRef.current = [];
        realtimeCaptureMimeTypeRef.current = "audio/webm";
        realtimeAwaitingReplyRef.current = false;
        realtimeAwaitingGreetingRef.current = false;
        realtimeTtsBase64Ref.current = "";
        realtimeConnectedRef.current = false;
        setRealtimeConnected(false);
        setRealtimeConnecting(false);
        realtimeListeningRef.current = false;
        setRealtimeListening(false);
        setRealtimePartialTranscript("");
        realtimeNeedsChoiceRef.current = false;
        setRealtimeNeedsConversationChoice(false);
        setRealtimePhase("idle");
        realtimeSocketRef.current = null;
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };
    });
  };

  const startRealtimeCapture = async () => {
    if (realtimeListening || realtimeConnecting || sending || mediaBusy || sttBusy || isRecording) return;
    if (realtimeAwaitingReplyRef.current || realtimePhase === "waiting" || realtimePhase === "speaking" || realtimePhase === "greeting") {
      setRealtimeStatus("GRIK is still processing the previous turn.");
      return;
    }
    setRealtimeError(null);
    if (realtimeNeedsChoiceRef.current) {
      realtimeNeedsChoiceRef.current = false;
      setRealtimeNeedsConversationChoice(false);
      setRealtimeStatus("Starting fresh. Say 'continue previous conversation' if you want history.");
    }
    const connected = await connectRealtimeSession();
    if (!connected) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setRealtimeError("Realtime microphone capture is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      realtimeStreamRef.current = stream;
      const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
      const selectedMime =
        preferredMimeTypes.find((mime) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) || "";
      const recorder = selectedMime ? new MediaRecorder(stream, { mimeType: selectedMime }) : new MediaRecorder(stream);
      realtimeMediaRecorderRef.current = recorder;
      realtimeChunksRef.current = [];
      realtimeCaptureMimeTypeRef.current = recorder.mimeType || selectedMime || "audio/webm";
      realtimePendingCommitRef.current = false;
      realtimeHasSpeechRef.current = false;
      realtimeCaptureStartedAtRef.current = Date.now();
      realtimeLastSpeechTsRef.current = Date.now();
      setRealtimePartialTranscript("");
      setRealtimeSpeechDetected(false);
      setRealtimeAudioLevel(0);
      if (realtimeCaptureTimeoutRef.current != null) {
        window.clearTimeout(realtimeCaptureTimeoutRef.current);
      }
      realtimeCaptureTimeoutRef.current = window.setTimeout(() => {
        if (realtimeListeningRef.current) {
          stopRealtimeCapture(true);
        }
      }, REALTIME_MAX_CAPTURE_MS);

      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        try {
          const audioContext = new AudioContextCtor();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          realtimeAudioContextRef.current = audioContext;
          realtimeVadIntervalRef.current = window.setInterval(() => {
            if (!realtimeListeningRef.current) return;
            analyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (let i = 0; i < samples.length; i += 1) {
              const normalized = (samples[i] - 128) / 128;
              sum += normalized * normalized;
            }
            const rms = Math.sqrt(sum / samples.length);
            const speaking = rms >= REALTIME_SPEECH_THRESHOLD;
            const level = Math.min(1, rms / (REALTIME_SPEECH_THRESHOLD * 3));
            const now = Date.now();
            if (speaking) {
              realtimeHasSpeechRef.current = true;
              realtimeLastSpeechTsRef.current = now;
            }
            setRealtimeSpeechDetected((prev) => (prev === speaking ? prev : speaking));
            setRealtimeAudioLevel((prev) => prev + (level - prev) * 0.35);

            const silenceMs = now - realtimeLastSpeechTsRef.current;
            const elapsedMs = now - realtimeCaptureStartedAtRef.current;
            if (
              realtimeHasSpeechRef.current &&
              silenceMs >= REALTIME_SILENCE_COMMIT_MS &&
              elapsedMs >= REALTIME_MIN_SPEECH_MS
            ) {
              stopRealtimeCapture(true);
            }
          }, REALTIME_VAD_INTERVAL_MS);
        } catch {
          // VAD not available; capture still works with manual stop.
        }
      }

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size <= 0) return;
        realtimeChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        realtimeMediaRecorderRef.current = null;
        void sendRealtimeCommit();
      };
      recorder.onerror = () => {
        setRealtimeError("Realtime recorder failed.");
        stopRealtimeCapture(false);
      };
      recorder.start(REALTIME_CHUNK_MS);
      realtimeListeningRef.current = true;
      setRealtimeListening(true);
      setRealtimePhase("listening");
      setRealtimeStatus("Realtime listening... speak now.");
      startRealtimeSpeechRecognition();
    } catch {
      stopRealtimeCapture(false);
      setRealtimeError("Could not access microphone for realtime voice.");
    }
  };

  const openRealtimeVoiceModal = async () => {
    realtimeModalOpenRef.current = true;
    setRealtimeModalOpen(true);
    setRealtimeError(null);
    setRealtimeStatus("Opening realtime voice session...");
    realtimeAwaitingGreetingRef.current = true;
    const connected = await connectRealtimeSession();
    if (!connected) {
      realtimeAwaitingGreetingRef.current = false;
      setRealtimeStatus(null);
      setRealtimePhase("idle");
    }
  };

  const closeRealtimeVoiceModal = () => {
    realtimeModalOpenRef.current = false;
    setRealtimeModalOpen(false);
    disconnectRealtimeSession();
  };

  const chooseRealtimeConversationPath = (path: "continue" | "new") => {
    const socket = realtimeSocketRef.current;
    const sentToServer = Boolean(socket && socket.readyState === WebSocket.OPEN);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "session.path", path }));
    }
    if (path === "new" && !sentToServer) {
      handleNewConversation();
    }
    realtimeNeedsChoiceRef.current = false;
    setRealtimeNeedsConversationChoice(false);
    setRealtimeStatus(path === "new" ? "New conversation started. Speak now." : "Continuing conversation. Speak now.");
    setRealtimePhase("paused");
    void startRealtimeCapture();
  };

  const stopRecordingTimers = () => {
    if (recordingTimerRef.current != null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recordingTickerRef.current != null) {
      window.clearInterval(recordingTickerRef.current);
      recordingTickerRef.current = null;
    }
  };

  const stopRecordingStream = () => {
    if (recordingStreamRef.current) {
      for (const track of recordingStreamRef.current.getTracks()) {
        track.stop();
      }
      recordingStreamRef.current = null;
    }
  };

  const stopAudioPlayback = () => {
    const player = audioPlayerRef.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
      player.src = "";
    }
    clearActivePlaybackUrl();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    browserSpeechUtteranceRef.current = null;
    setPlayingMessageId(null);
    setAudioStatus(null);
  };

  const transcribeAudioFile = async (file: File, options?: { autoSend?: boolean }) => {
    const autoSend = Boolean(options?.autoSend);
    setAudioError(null);
    setAudioStatus(autoSend ? "Transcribing and sending..." : "Transcribing voice note...");
    setSttBusy(true);
    try {
      const result = await api.chatTranscribeAudio({
        file,
        locale_hint: localeHint,
      });
      const transcript = (result.transcript || "").trim();
      if (!transcript) {
        setAudioError("No speech detected. Try recording closer to the phone microphone.");
        return;
      }
      if (autoSend) {
        setAudioStatus("Voice note transcribed. Sending to GRIK...");
        await ask(
          transcript,
          buildMediaAskOptions(),
          {
            bypassVoiceBusyGuard: true,
            fromRealtimeVoice: false,
          }
        );
      } else {
        setInput((prev) => {
          const current = prev.trim();
          if (!current) return transcript;
          return `${current}\n${transcript}`;
        });
        setAudioStatus("Voice note transcribed. Review and send to GRIK.");
      }
    } catch (err) {
      setAudioStatus(null);
      setAudioError(parseApiError(err));
    } finally {
      setSttBusy(false);
    }
  };

  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
    stopRecordingTimers();
    setAudioStatus(recordingAutoSendRef.current ? "Processing one-click recording..." : "Processing recording...");
  };

  const startVoiceRecording = async (autoSend = recordAndSendMode) => {
    if (sending || mediaBusy || sttBusy || isRecording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioError("Audio recording is not supported in this browser.");
      return;
    }

    recordingAutoSendRef.current = Boolean(autoSend);
    setAudioError(null);
    setAudioStatus(autoSend ? "One-click mode active: speak now..." : "Listening... speak clearly.");
    setRecordingElapsed(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;

      const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
      const selectedMime =
        preferredMimeTypes.find((mime) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) || "";

      const recorder = selectedMime ? new MediaRecorder(stream, { mimeType: selectedMime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setAudioError("Microphone recording failed. Check browser permissions and retry.");
        setAudioStatus(null);
        setIsRecording(false);
        stopRecordingTimers();
        stopRecordingStream();
        mediaRecorderRef.current = null;
      };
      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        const mimeType = recorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunks, { type: mimeType });
        stopRecordingTimers();
        stopRecordingStream();
        mediaRecorderRef.current = null;
        setIsRecording(false);

        if (!audioBlob.size) {
          setAudioStatus(null);
          setAudioError("No audio captured. Try again.");
          return;
        }

        void (async () => {
          const wavBlob = await convertAudioBlobToWav(audioBlob);
          const payloadBlob = wavBlob && wavBlob.size ? wavBlob : audioBlob;
          const payloadMime = payloadBlob.type || mimeType || "audio/webm";
          const ext = guessAudioExtension(payloadMime);
          const file = new File([payloadBlob], `grik-voice-${Date.now()}.${ext}`, { type: payloadMime });
          await transcribeAudioFile(file, { autoSend: recordingAutoSendRef.current });
        })();
      };

      recorder.start(250);
      setIsRecording(true);
      const maxSeconds = autoSend ? AUTO_RECORD_AND_SEND_SECONDS : MAX_RECORDING_SECONDS;
      recordingTickerRef.current = window.setInterval(() => {
        setRecordingElapsed((prev) => {
          const next = prev + 1;
          return next >= maxSeconds ? maxSeconds : next;
        });
      }, 1000);
      recordingTimerRef.current = window.setTimeout(() => {
        stopVoiceRecording();
      }, maxSeconds * 1000);
    } catch {
      stopRecordingTimers();
      stopRecordingStream();
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setAudioStatus(null);
      setAudioError("Microphone access was denied or unavailable.");
    }
  };

  const handleAudioSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setAudioError("Please upload a valid audio file.");
      return;
    }
    void transcribeAudioFile(file, { autoSend: false });
  };

  const getSpeechAudioUrl = async (msg: ChatMessage): Promise<string> => {
    const cached = audioCacheRef.current.get(msg.id);
    if (cached) return cached;

    const result = await api.chatSynthesizeAudio({
      text: msg.message,
      locale_hint: msg.language || localeHint,
      voice_hint: resolveVoiceHint(ttsVoiceProfile),
    });
    const blob =
      result.blob.type && result.blob.type !== "application/octet-stream"
        ? result.blob
        : new Blob([result.blob], { type: result.contentType || "audio/wav" });
    const objectUrl = URL.createObjectURL(blob);
    audioCacheRef.current.set(msg.id, objectUrl);
    if (audioCacheRef.current.size > 40) {
      const oldestKey = audioCacheRef.current.keys().next().value as number | undefined;
      if (oldestKey != null) {
        const oldestUrl = audioCacheRef.current.get(oldestKey);
        if (oldestUrl) {
          URL.revokeObjectURL(oldestUrl);
        }
        audioCacheRef.current.delete(oldestKey);
      }
    }
    return objectUrl;
  };

  const playAssistantAudio = async (msg: ChatMessage) => {
    if (msg.role !== "assistant") return;
    if (playingMessageId === msg.id) {
      stopAudioPlayback();
      return;
    }

    setAudioError(null);
    setTtsBusyMessageId(msg.id);
    try {
      const audioUrl = await getSpeechAudioUrl(msg);
      stopAudioPlayback();

      let player = audioPlayerRef.current;
      if (!player) {
        player = new Audio();
        audioPlayerRef.current = player;
      }
      player.src = audioUrl;
      player.onended = () => {
        setPlayingMessageId(null);
        setAudioStatus(null);
      };
      player.onerror = () => {
        setPlayingMessageId(null);
        setAudioError("This device could not play the voice reply.");
      };

      await player.play();
      setPlayingMessageId(msg.id);
      setAudioStatus("Playing GRIK voice response...");
    } catch (err) {
      if (ENABLE_BROWSER_TTS_FALLBACK) {
        const fallbackSpoken = speakWithBrowserSpeech(msg.message, {
          localeHint: msg.language || localeHint,
          statusText: "Using your device voice...",
          onStart: () => {
            setPlayingMessageId(msg.id);
          },
          onEnded: () => {
            setPlayingMessageId(null);
            setAudioStatus(null);
          },
          onError: () => {
            setPlayingMessageId(null);
            setAudioStatus(null);
          },
        });
        if (!fallbackSpoken) {
          setAudioStatus(null);
          setAudioError(parseApiError(err));
        }
      } else {
        setAudioStatus(null);
        setAudioError(parseApiError(err));
      }
    } finally {
      setTtsBusyMessageId((current) => (current === msg.id ? null : current));
    }
  };

  const ensureActiveConversation = () => {
    if (activeConversation) return activeConversation.id;
    const fresh = createConversation();
    setConversations([fresh]);
    setActiveConversationId(fresh.id);
    return fresh.id;
  };

  const ask = async (
    text: string,
    options?: {
      files?: File[];
      attachmentLabel?: string;
      cropHint?: string;
      modelPreference?: string;
      deepAnalysis?: boolean;
    },
    runtime?: {
      bypassVoiceBusyGuard?: boolean;
      fromRealtimeVoice?: boolean;
    }
  ) => {
    const trimmed = text.trim();
    const files = options?.files ?? [];
    const hasMedia = files.length > 0;
    const selectedCrop = (options?.cropHint || "").trim();
    const selectedModel = (options?.modelPreference || "auto").trim() || "auto";
    const useDeepAnalysis = Boolean(options?.deepAnalysis);
    const effectiveMessage = trimmed || (hasMedia ? "Analyze these crop photos and recommend immediate actions." : "");
    const bypassGuard = Boolean(runtime?.bypassVoiceBusyGuard);
    if ((!effectiveMessage && !hasMedia) || (!bypassGuard && (sending || mediaBusy || sttBusy || isRecording))) return;

    const conversationId = ensureActiveConversation();
    const tempId = Date.now();
    const now = new Date().toISOString();
    const attachmentLabel = options?.attachmentLabel || `${files.length} file(s)`;
    const mediaMeta: string[] = [];
    if (hasMedia) {
      mediaMeta.push(`Attached media: ${attachmentLabel}`);
      if (selectedCrop) mediaMeta.push(`Crop: ${selectedCrop}`);
      if (selectedModel) mediaMeta.push(`Model: ${selectedModel}`);
      if (useDeepAnalysis) mediaMeta.push("Deep analysis: on");
    }
    const voicePrefix = runtime?.fromRealtimeVoice ? `${REALTIME_USER_MESSAGE_PREFIX} ` : "";
    const userMessage = hasMedia
      ? `${voicePrefix}${effectiveMessage}\n\n[${mediaMeta.join(" | ")}]`
      : `${voicePrefix}${effectiveMessage}`;

    setConversationMessages(conversationId, (messages) => [
      ...messages,
      { id: tempId, role: "user", message: userMessage, created_at: now },
    ]);

    setInput("");
    setSending(true);
    setError(null);
    setStatusNote(null);
    setAudioError(null);

    try {
      const response = hasMedia
        ? await api.chatAskMultimodal({
            message: effectiveMessage,
            locale_hint: localeHint,
            location_hint: locationHint,
            crop_hint: selectedCrop || undefined,
            model_preference: selectedModel || "auto",
            deep_analysis: useDeepAnalysis,
            files,
          })
        : await api.chatAsk({
            message: effectiveMessage,
            locale_hint: localeHint,
            location_hint: locationHint,
          });
      setConversationMessages(conversationId, (messages) => [
        ...messages,
        {
          id: tempId + 1,
          role: "assistant",
          message: response.reply,
          created_at: new Date().toISOString(),
          language: response.language,
          source_confidence: response.source_confidence,
          citation_text: response.citation_text,
          citations: response.citations,
          follow_ups: response.follow_ups,
          media_analysis: response.media_analysis,
        },
      ]);
      if (hasMedia) {
        setSelectedImages([]);
        setVideoFrames([]);
        setVideoFileName("");
        setMediaError(null);
      }
      setAudioStatus(null);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setSending(false);
    }
  };

  const buildMediaAskOptions = () => {
    if (attachedFileCount <= 0) return undefined;
    return {
      files: [...selectedImages, ...videoFrames],
      attachmentLabel: mediaAttachmentLabel,
      cropHint: cropHint || undefined,
      modelPreference,
      deepAnalysis,
    };
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(input, buildMediaAskOptions());
    }
  };

  const clearMediaAttachments = () => {
    setSelectedImages([]);
    setVideoFrames([]);
    setVideoFileName("");
    setMediaError(null);
  };

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    event.target.value = "";
    if (picked.length === 0) {
      return;
    }

    setMediaError(null);
    setSelectedImages((prev) => {
      const availableSlots = Math.max(0, MAX_MEDIA_FILES - videoFrames.length);
      const merged = [...prev, ...picked].slice(0, availableSlots);
      if (merged.length < prev.length + picked.length) {
        setMediaError(`Only ${MAX_MEDIA_FILES} media files can be analyzed at once.`);
      }
      return merged;
    });
  };

  const handleVideoSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("video/")) {
      setMediaError("Please upload a video file.");
      return;
    }

    setMediaBusy(true);
    setMediaError(null);
    try {
      const extracted = await extractFramesFromVideo(file, VIDEO_FRAME_COUNT, MAX_VIDEO_SECONDS);
      const availableSlots = Math.max(0, MAX_MEDIA_FILES - selectedImages.length);
      const bounded = extracted.slice(0, availableSlots);
      if (bounded.length === 0) {
        throw new Error(`No space left for video frames. Maximum is ${MAX_MEDIA_FILES} media files.`);
      }
      setVideoFrames(bounded);
      setVideoFileName(file.name);
      if (bounded.length < extracted.length) {
        setMediaError(`Video produced more frames than available slots. Kept ${bounded.length} frame(s).`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Failed to process uploaded video.";
      setVideoFrames([]);
      setVideoFileName("");
      setMediaError(detail);
    } finally {
      setMediaBusy(false);
    }
  };

  const handleNewConversation = () => {
    stopAudioPlayback();
    const fresh = createConversation();
    setConversations((prev) => [fresh, ...prev]);
    setActiveConversationId(fresh.id);
    setInput("");
    setStatusNote("Started a new conversation.");
    setError(null);
  };

  const copyMessage = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setStatusNote("Message copied.");
    } catch {
      setStatusNote("Unable to copy message on this browser.");
    }
  };

  const copyConversation = async () => {
    if (!activeConversation || activeConversation.messages.length === 0) {
      setStatusNote("No messages to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(buildConversationText(activeConversation));
      setStatusNote("Conversation copied.");
    } catch {
      setStatusNote("Unable to copy conversation on this browser.");
    }
  };

  const exportConversation = (format: "txt" | "json") => {
    if (!activeConversation || activeConversation.messages.length === 0) {
      setStatusNote("No messages to export.");
      return;
    }
    const safeTitle = activeConversation.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const stem = safeTitle || "conversation";
    const date = new Date().toISOString().slice(0, 10);

    if (format === "txt") {
      downloadFile(`${stem}-${date}.txt`, buildConversationText(activeConversation), "text/plain;charset=utf-8");
      setStatusNote("Conversation exported as TXT.");
      return;
    }

    downloadFile(
      `${stem}-${date}.json`,
      JSON.stringify(
        {
          title: activeConversation.title,
          created_at: activeConversation.created_at,
          messages: activeConversation.messages,
        },
        null,
        2
      ),
      "application/json;charset=utf-8"
    );
    setStatusNote("Conversation exported as JSON.");
  };

  return (
    <section className="farmer-page farmer-brain-page">
      <div className="farmer-page-header grik-page-header">
        <div>
          <div className="label">Dashboard Brain</div>
          <h1>GRIK Brain</h1>
          <p className="muted">Ask with text, voice, photos, or short video and get grounded farm guidance fast.</p>
        </div>
        <div className="grik-page-actions">
          <button className="btn ghost small" type="button" onClick={handleNewConversation}>
            <Icon name="plus" size={14} />
            New chat
          </button>
          <button
            className={`btn small ${realtimeModalOpen && realtimeConnected ? "ghost" : ""}`}
            type="button"
            onClick={() => {
              if (realtimeModalOpen) {
                closeRealtimeVoiceModal();
                return;
              }
              void openRealtimeVoiceModal();
            }}
            disabled={sending || mediaBusy || sttBusy || isRecording}
          >
            <Icon name="wave" size={14} />
            {realtimeModalOpen ? "Close live voice" : "Open live voice"}
          </button>
        </div>
      </div>

      {compactStatusItems.length > 0 ? (
        <div className="grik-status-stack">
          {compactStatusItems.map((item, index) => (
            <p key={`${item.tone}-${index}`} className={`status ${item.tone === "error" ? "error" : ""}`}>
              {item.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grik-hero-grid">
        <section className="farmer-card grik-hero-card grik-hero-card-primary">
          <div className="label">Workspace</div>
          <h3>Ready for crop advice, checks, and field decisions</h3>
          <p className="muted">Capture what you see, ask what to do next, and keep follow-ups in one running thread.</p>
          <div className="farmer-chip-row">
            <span className="chip">{profile?.user.phone ?? user?.phone ?? "Unknown farmer"}</span>
            <span className="chip">{localeHint ?? "Language auto"}</span>
            <span className="chip">{locationHint ?? "Add location in profile"}</span>
          </div>
        </section>

        <section className="farmer-card grik-hero-card">
          <div className="label">Context coverage</div>
          <h3>{contextCoverageCount}/4 signals ready</h3>
          <div className="grik-hero-metrics">
            <div className="grik-hero-metric">
              <span>Location</span>
              <strong>{locationHint || weather?.location_name ? "Ready" : "Missing"}</strong>
            </div>
            <div className="grik-hero-metric">
              <span>Crops</span>
              <strong>{(profile?.farm.crops ?? []).length || 0}</strong>
            </div>
            <div className="grik-hero-metric">
              <span>Weather</span>
              <strong>{weather?.days?.length ? `${weather.days.length} days` : "Pending"}</strong>
            </div>
            <div className="grik-hero-metric">
              <span>Market</span>
              <strong>{topPrediction ? topPrediction.direction : "Pending"}</strong>
            </div>
          </div>
        </section>

        <section className="farmer-card grik-hero-card">
          <div className="label">Live voice</div>
          <h3>{liveVoiceStateLabel}</h3>
          {weather?.next_rain_date ? (
            <p className="muted">Rain window: {new Date(weather.next_rain_date).toLocaleDateString()}.</p>
          ) : (
            <p className="muted">Use live voice for hands-free questions when you are in the field.</p>
          )}
          <div className="farmer-chip-row">
            <span className="chip">Voice: {selectedVoiceProfile.label}</span>
            <span className="chip">{autoSpeakReplies ? "Auto reply on" : "Auto reply off"}</span>
            <span className="chip">{realtimeConnected ? "Connected" : "Tap to connect"}</span>
          </div>
        </section>
      </div>

      <div className="grik-layout">
        <section className="farmer-card grik-chat-card">
          <div className="grik-toolbar">
            <button
              className="btn small"
              type="button"
              onClick={handleNewConversation}
              title="New conversation"
              aria-label="Create new conversation"
            >
              <Icon name="plus" size={15} />
              New
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={copyConversation}
              title="Copy current conversation"
              aria-label="Copy current conversation"
            >
              <Icon name="copy" size={14} />
              Copy
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => exportConversation("txt")}
              title="Export TXT"
              aria-label="Export conversation as TXT"
            >
              <Icon name="download" size={14} />
              TXT
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => exportConversation("json")}
              title="Export JSON"
              aria-label="Export conversation as JSON"
            >
              <Icon name="download" size={14} />
              JSON
            </button>
          </div>

          <div className="grik-conversation-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`grik-conversation-item ${activeConversation?.id === conversation.id ? "active" : ""}`}
                onClick={() => setActiveConversationId(conversation.id)}
              >
                <span className="grik-conversation-title">{conversation.title}</span>
                <span className="grik-conversation-meta">
                  {formatDate(conversation.created_at)} | {conversation.messages.length} messages
                </span>
              </button>
            ))}
          </div>

          <div className="grik-session-metrics">
            <article className="grik-session-metric-card">
              <span className="label">Chats</span>
              <strong>{conversations.length}</strong>
              <span className="muted">Saved threads</span>
            </article>
            <article className="grik-session-metric-card">
              <span className="label">Replies</span>
              <strong>{assistantMessageCount}</strong>
              <span className="muted">GRIK responses</span>
            </article>
            <article className="grik-session-metric-card">
              <span className="label">Evidence</span>
              <strong>{groundedMessageCount}</strong>
              <span className="muted">Grounded turns</span>
            </article>
            <article className="grik-session-metric-card">
              <span className="label">Media</span>
              <strong>{mediaMessageCount}</strong>
              <span className="muted">Analyzed turns</span>
            </article>
          </div>

          <div className="farmer-card-header">
            <div>
              <div className="label">Smart prompts</div>
              <h3>Quick starts</h3>
            </div>
          </div>

          <div className="grik-prompt-grid">
            {promptSuggestions.map((prompt) => (
              <button
                key={prompt}
                className="grik-prompt-card"
                type="button"
                disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                onClick={() => void ask(prompt, buildMediaAskOptions())}
              >
                {prompt}
              </button>
            ))}
          </div>

          <FarmerBrainMessageStream
            activeConversationTitle={activeConversation?.title ?? "New conversation"}
            activeConversationMeta={
              activeConversation
                ? `${formatDate(activeConversation.created_at)} | ${activeMessages.length} messages`
                : "Start with a crop symptom or farm decision question."
            }
            activeMessages={activeMessages}
            attachedLabel={attachedFileCount > 0 ? mediaAttachmentLabel : "No media attached"}
            deepAnalysis={deepAnalysis}
            sending={sending}
            mediaBusy={mediaBusy}
            sttBusy={sttBusy}
            isRecording={isRecording}
            realtimeListening={realtimeListening}
            ttsBusyMessageId={ttsBusyMessageId}
            playingMessageId={playingMessageId}
            onPlayAssistantAudio={playAssistantAudio}
            onCopyMessage={copyMessage}
            onAskFollowUp={(message) => ask(message, buildMediaAskOptions())}
            formatTime={formatTime}
            formatCitation={formatCitation}
            messageEndRef={messageEndRef}
          />

          <div className="chat-input grik-composer">
            <div className="grik-composer-shell">
              <div className="grik-composer-head">
                <div>
                  <div className="label">Ask GRIK</div>
                  <h3>Text, voice, photo, or short video</h3>
                  <p className="muted">Capture what you see, add context, then send once.</p>
                </div>
                {attachedFileCount > 0 ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={clearMediaAttachments}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  >
                    <Icon name="trash" size={13} />
                    Clear media
                  </button>
                ) : null}
              </div>

              <div className="grik-input-mode-grid">
                <label className="grik-mode-card">
                  <span className="grik-mode-icon">
                    <Icon name="voice" size={16} />
                  </span>
                  <strong>Upload audio</strong>
                  <span>Turn speech into text.</span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioSelection}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  />
                </label>

                <button
                  className={`grik-mode-card ${isRecording ? "is-recording" : ""}`}
                  type="button"
                  onClick={() => {
                    if (isRecording) {
                      stopVoiceRecording();
                      return;
                    }
                    void startVoiceRecording(recordAndSendMode);
                  }}
                  disabled={sending || mediaBusy || sttBusy || realtimeListening}
                >
                  <span className="grik-mode-icon">
                    <Icon name={isRecording ? "stop" : "voice"} size={16} />
                  </span>
                  <strong>{isRecording ? "Stop recording" : "Record note"}</strong>
                  <span>{recordAndSendMode ? "One tap sends after recording." : `Up to ${MAX_RECORDING_SECONDS}s voice note.`}</span>
                </button>

                <button
                  className={`grik-mode-card ${realtimeModalOpen && realtimeConnected ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    if (realtimeModalOpen) {
                      closeRealtimeVoiceModal();
                      return;
                    }
                    void openRealtimeVoiceModal();
                  }}
                  disabled={sending || mediaBusy || sttBusy || isRecording}
                >
                  <span className="grik-mode-icon">
                    <Icon name="wave" size={16} />
                  </span>
                  <strong>{realtimeModalOpen ? "Live voice open" : "Live voice"}</strong>
                  <span>Hands-free back-and-forth in the field.</span>
                </button>

                <button
                  className={`grik-mode-card ${recordAndSendMode ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setRecordAndSendMode((prev) => !prev)}
                  disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                >
                  <span className="grik-mode-icon">
                    <Icon name="send" size={16} />
                  </span>
                  <strong>One-tap send</strong>
                  <span>{recordAndSendMode ? "Enabled for quick voice turns." : "Auto-send after short voice capture."}</span>
                </button>

                <label className="grik-mode-card">
                  <span className="grik-mode-icon">
                    <Icon name="upload" size={16} />
                  </span>
                  <strong>Upload photos</strong>
                  <span>Add one or more field images.</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageSelection}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  />
                </label>

                <label className="grik-mode-card">
                  <span className="grik-mode-icon">
                    <Icon name="camera" size={16} />
                  </span>
                  <strong>Capture photo</strong>
                  <span>Use the phone camera now.</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageSelection}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  />
                </label>

                <label className="grik-mode-card">
                  <span className="grik-mode-icon">
                    <Icon name="video" size={16} />
                  </span>
                  <strong>Upload video</strong>
                  <span>Short clip, max {MAX_VIDEO_SECONDS}s.</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(event) => {
                      void handleVideoSelection(event);
                    }}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  />
                </label>

                <label className="grik-mode-card">
                  <span className="grik-mode-icon">
                    <Icon name="video" size={16} />
                  </span>
                  <strong>Capture video</strong>
                  <span>Record a short field clip.</span>
                  <input
                    type="file"
                    accept="video/*"
                    capture="environment"
                    onChange={(event) => {
                      void handleVideoSelection(event);
                    }}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  />
                </label>
              </div>

              <div className="grik-composer-summary-row">
                <article className="grik-summary-card">
                  <span className="label">Media</span>
                  <strong>{attachedFileCount > 0 ? mediaAttachmentLabel : "No attachments yet"}</strong>
                  <span className="muted">Up to {MAX_MEDIA_FILES} files total.</span>
                </article>
                <article className="grik-summary-card">
                  <span className="label">Voice</span>
                  <strong>{selectedVoiceProfile.label}</strong>
                  <span className="muted">{autoSpeakReplies ? "Replies can play automatically." : "Reply playback is manual."}</span>
                </article>
                <article className="grik-summary-card">
                  <span className="label">Analysis</span>
                  <strong>{deepAnalysis ? "Deep review on" : "Fast review on"}</strong>
                  <span className="muted">{selectedModelTip}</span>
                </article>
              </div>

              <div className="grik-media-config-row">
                <label className="grik-media-config-field">
                  Crop
                  <select value={cropHint} onChange={(event) => setCropHint(event.target.value)} disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}>
                    <option value="">Auto from profile</option>
                    {cropOptions.map((crop) => (
                      <option key={crop} value={crop}>
                        {crop}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grik-media-config-field">
                  Vision model
                  <select
                    value={modelPreference}
                    onChange={(event) => setModelPreference(event.target.value)}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  >
                    {visionModelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grik-media-config-field">
                  Voice profile
                  <select
                    value={ttsVoiceProfile}
                    onChange={(event) => {
                      const next = String(event.target.value || "").trim().toLowerCase();
                      if (isVoiceProfile(next)) {
                        setTtsVoiceProfile(next);
                      }
                    }}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  >
                    {VOICE_PROFILE_OPTIONS.map((profileOption) => (
                      <option key={profileOption.id} value={profileOption.id}>
                        {profileOption.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grik-media-check">
                  <input
                    type="checkbox"
                    checked={deepAnalysis}
                    onChange={(event) => setDeepAnalysis(event.target.checked)}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  />
                  Deep analysis
                </label>
                <label className="grik-media-check">
                  <input
                    type="checkbox"
                    checked={autoSpeakReplies}
                    onChange={() => setAutoSpeakReplies((prev) => !prev)}
                    disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                  />
                  Auto-play replies
                </label>
              </div>

              <div className="grik-note-strip">
                <span>{selectedModelTip}</span>
                <span>Voice notes can run up to {MAX_RECORDING_SECONDS}s.</span>
                <span>One-tap send auto-stops after {AUTO_RECORD_AND_SEND_SECONDS}s.</span>
                <span>Video becomes {VIDEO_FRAME_COUNT} still frames.</span>
              </div>

              {isRecording || videoFileName || mediaError || audioError || audioStatus || realtimePartialTranscript ? (
                <div className="grik-composer-status-row">
                  {isRecording ? (
                    <p className="status">
                      Recording {recordingElapsed}s / {recordingAutoSendRef.current ? AUTO_RECORD_AND_SEND_SECONDS : MAX_RECORDING_SECONDS}s
                    </p>
                  ) : null}
                  {videoFileName ? (
                    <p className="status">
                      Video ready: {videoFileName} ({videoFrames.length} extracted frame{videoFrames.length === 1 ? "" : "s"})
                    </p>
                  ) : null}
                  {mediaError ? <p className="status error">{mediaError}</p> : null}
                  {audioError ? <p className="status error">{audioError}</p> : null}
                  {audioStatus ? <p className="status">{audioStatus}</p> : null}
                  {realtimePartialTranscript ? <p className="status">Live transcript: {realtimePartialTranscript}</p> : null}
                </div>
              ) : null}

              {attachedFileCount > 0 ? (
                <div className="grik-media-preview-grid">
                  {selectedImagePreviews.map((preview, index) => (
                    <div key={`image-${preview.name}-${index}`} className="grik-media-preview-card">
                      <img src={preview.url} alt={preview.name} />
                      <span className="grik-media-preview-label">Photo {index + 1}</span>
                    </div>
                  ))}
                  {videoFramePreviews.map((preview, index) => (
                    <div key={`frame-${preview.name}-${index}`} className="grik-media-preview-card">
                      <img src={preview.url} alt={preview.name} />
                      <span className="grik-media-preview-label">Video frame {index + 1}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <textarea
                placeholder="Example: My cassava leaves are curling with white spots. Give immediate actions and what to check over the next 7 days."
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
                rows={4}
              />

              <div className="grik-composer-actions">
                <button
                  className="btn grik-send-btn"
                  type="button"
                  onClick={() => void ask(input, buildMediaAskOptions())}
                  disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                >
                  <Icon name="send" size={15} />
                  {mediaBusy
                    ? "Preparing media..."
                    : isRecording
                      ? "Recording..."
                      : realtimeListening
                        ? "Live voice running..."
                        : sttBusy
                          ? "Transcribing..."
                          : sending
                            ? "Analyzing..."
                            : "Send to GRIK"}
                </button>
                <p className="muted">
                  {attachedFileCount > 0
                    ? "Attached media will be analyzed together with your question."
                    : "Tip: add photos or voice when symptoms are hard to describe."}
                </p>
              </div>
            </div>
          </div>
        </section>

        <aside className="grik-side">
          <section className="farmer-card">
            <div className="label">Weather context</div>
            <h3>Planning window</h3>
            {contextLoading ? (
              <p className="muted">Loading context...</p>
            ) : weather && weather.days.length > 0 ? (
              <div className="grik-weather-list">
                {weather.days.slice(0, 3).map((day) => (
                  <div key={day.date} className="grik-weather-item">
                    <div>{new Date(day.date).toLocaleDateString()}</div>
                    <div className="muted">
                      {day.temp_max_c != null ? Math.round(day.temp_max_c) : "--"} / {day.temp_min_c != null ? Math.round(day.temp_min_c) : "--"} C
                    </div>
                    <div className="muted">{day.precipitation_mm != null ? `${day.precipitation_mm.toFixed(1)} mm rain` : "No rain data"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Set district/parish in Farm Profile for localized weather planning.</p>
            )}
          </section>

          <section className="farmer-card">
            <div className="label">Market context</div>
            <h3>Price pulse</h3>
            {topPrediction ? (
              <div className="grik-market-item">
                <div>
                  <strong>{topPrediction.crop}</strong>
                </div>
                <div className="muted">
                  {topPrediction.district ? `${topPrediction.district} | ` : ""}
                  {topPrediction.direction} | {topPrediction.currency}
                  {topPrediction.predicted_price}
                </div>
                <div className="muted">Confidence: {Math.round(topPrediction.confidence * 100)}%</div>
              </div>
            ) : (
              <p className="muted">No strong market prediction yet.</p>
            )}
          </section>

          <section className="farmer-card">
            <div className="label">Current setup</div>
            <h3>Session readiness</h3>
            <div className="grik-side-summary">
              <div className="grik-side-summary-item">
                <span>Crop focus</span>
                <strong>{cropHint || (profile?.farm.crops ?? []).slice(0, 2).join(", ") || "Auto"}</strong>
              </div>
              <div className="grik-side-summary-item">
                <span>Model</span>
                <strong>{visionModelOptions.find((model) => model.id === modelPreference)?.label ?? "Auto"}</strong>
              </div>
              <div className="grik-side-summary-item">
                <span>Voice</span>
                <strong>{selectedVoiceProfile.label}</strong>
              </div>
              <div className="grik-side-summary-item">
                <span>Live voice</span>
                <strong>{liveVoiceStateLabel}</strong>
              </div>
            </div>
          </section>

          <section className="farmer-card">
            <div className="label">How GRIK helps</div>
            <h3>Decision support</h3>
            <ul className="grik-stack-list">
              <li>Uses your crop, language, and location when available</li>
              <li>Combines manuals, recent context, and model reasoning</li>
              <li>Reads photos and short video when you attach field evidence</li>
              <li>Suggests follow-up questions to keep the diagnosis moving</li>
            </ul>
          </section>
        </aside>
      </div>

      <FarmerBrainRealtimeModal
        open={realtimeModalOpen}
        realtimePhase={realtimePhase}
        realtimePhaseLabel={realtimePhaseLabel}
        realtimeConnected={realtimeConnected}
        realtimeListening={realtimeListening}
        realtimeConnecting={realtimeConnecting}
        realtimeAudioLevel={realtimeAudioLevel}
        realtimePartialTranscript={realtimePartialTranscript}
        realtimeAssistantCue={realtimeAssistantCue}
        realtimeError={realtimeError}
        realtimeNeedsConversationChoice={realtimeNeedsConversationChoice}
        realtimePrimaryActionLabel={realtimePrimaryActionLabel}
        realtimeRecentAssistantText={realtimeRecentAssistantText}
        realtimeSessionFacts={realtimeSessionFacts}
        voiceProfile={ttsVoiceProfile}
        voiceOptions={VOICE_PROFILE_OPTIONS}
        selectedVoiceDetail={selectedVoiceProfile.detail}
        disableVoiceProfile={realtimeListening || realtimePhase === "speaking" || realtimePhase === "greeting"}
        sending={sending}
        mediaBusy={mediaBusy}
        sttBusy={sttBusy}
        isRecording={isRecording}
        onClose={closeRealtimeVoiceModal}
        onVoiceProfileChange={(value) => {
          const next = String(value || "").trim().toLowerCase();
          if (isVoiceProfile(next)) {
            setTtsVoiceProfile(next);
          }
        }}
        onChoosePath={chooseRealtimeConversationPath}
        onToggleCapture={() => {
          if (realtimeListening) {
            stopRealtimeCapture(true);
            return;
          }
          void startRealtimeCapture();
        }}
      />
    </section>
  );
}
