import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "./Visuals";
import type { VisionAnalysis } from "../lib/api";

type AdviceCitation = {
  source_id?: string | null;
  title?: string | null;
  page?: string | null;
  file?: string | null;
  url?: string | null;
};

type BrainMessage = {
  id: number;
  role: "user" | "assistant";
  message: string;
  created_at: string;
  source_confidence?: number;
  citations?: AdviceCitation[];
  follow_ups?: string[];
  media_analysis?: VisionAnalysis;
};

type MessageStreamProps = {
  activeConversationTitle: string;
  activeConversationMeta: string;
  activeMessages: BrainMessage[];
  attachedLabel: string;
  deepAnalysis: boolean;
  sending: boolean;
  mediaBusy: boolean;
  sttBusy: boolean;
  isRecording: boolean;
  realtimeListening: boolean;
  ttsBusyMessageId: number | null;
  playingMessageId: number | null;
  onPlayAssistantAudio: (message: BrainMessage) => Promise<void>;
  onCopyMessage: (message: string) => Promise<void>;
  onAskFollowUp: (message: string) => Promise<void>;
  formatTime: (iso: string) => string;
  formatCitation: (citation: AdviceCitation) => string;
  messageEndRef: React.RefObject<HTMLDivElement>;
};

type RealtimePhase = "idle" | "connecting" | "greeting" | "listening" | "waiting" | "speaking" | "paused";

type VoiceOption = {
  id: string;
  label: string;
};

type RealtimeModalProps = {
  open: boolean;
  realtimePhase: RealtimePhase;
  realtimePhaseLabel: string;
  realtimeConnected: boolean;
  realtimeListening: boolean;
  realtimeConnecting: boolean;
  realtimeAudioLevel: number;
  realtimePartialTranscript: string;
  realtimeAssistantCue: string;
  realtimeError: string | null;
  realtimeNeedsConversationChoice: boolean;
  realtimePrimaryActionLabel: string;
  realtimeRecentAssistantText: string;
  realtimeSessionFacts: string[];
  voiceProfile: string;
  voiceOptions: VoiceOption[];
  selectedVoiceDetail: string;
  disableVoiceProfile: boolean;
  sending: boolean;
  mediaBusy: boolean;
  sttBusy: boolean;
  isRecording: boolean;
  onClose: () => void;
  onVoiceProfileChange: (value: string) => void;
  onChoosePath: (path: "continue" | "new") => void;
  onToggleCapture: () => void;
};

function renderMediaAnalysis(message: BrainMessage) {
  const analysis = message.media_analysis;
  if (!analysis) return null;

  return (
    <div className="grik-media-analysis-card">
      <div className="label">Media findings</div>
      <p className="muted">{analysis.overall_assessment || "No summary provided."}</p>
      {analysis.crop_hint ? <p className="muted">Crop hint: {analysis.crop_hint}</p> : null}
      {analysis.selected_model_reason ? <p className="muted">{analysis.selected_model_reason}</p> : null}
      <div className="grik-media-issue-row">
        {analysis.likely_issues.slice(0, 4).map((issue) => (
          <span key={`${message.id}-${issue.name}-${issue.category}`} className="grik-citation-pill">
            {issue.name} ({Math.round(issue.confidence * 100)}%)
          </span>
        ))}
      </div>
      {analysis.model_runs && analysis.model_runs.length > 1 ? (
        <div className="grik-media-model-runs">
          {analysis.model_runs.slice(0, 4).map((run) => (
            <div key={`${message.id}-${run.model}`} className="grik-media-model-card">
              <div className="label">{run.model}</div>
              <p className="muted">Score: {Math.round(run.quality_score * 100)}%</p>
            </div>
          ))}
        </div>
      ) : null}
      {analysis.per_image_notes && analysis.per_image_notes.length > 0 ? (
        <div className="grik-media-per-image">
          {analysis.per_image_notes.slice(0, 6).map((note) => (
            <p key={`${message.id}-${note}`} className="muted">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FarmerBrainMessageStream({
  activeConversationTitle,
  activeConversationMeta,
  activeMessages,
  attachedLabel,
  deepAnalysis,
  sending,
  mediaBusy,
  sttBusy,
  isRecording,
  realtimeListening,
  ttsBusyMessageId,
  playingMessageId,
  onPlayAssistantAudio,
  onCopyMessage,
  onAskFollowUp,
  formatTime,
  formatCitation,
  messageEndRef,
}: MessageStreamProps) {
  return (
    <>
      <div className="grik-stream-header">
        <div>
          <div className="label">Active chat</div>
          <h3>{activeConversationTitle}</h3>
          <p className="muted">{activeConversationMeta}</p>
        </div>
        <div className="grik-stream-badges">
          <span className="chip">{attachedLabel}</span>
          <span className="chip">{deepAnalysis ? "Deep analysis on" : "Fast analysis"}</span>
        </div>
      </div>

      <div className="chat-messages grik-chat-stream">
        {activeMessages.length === 0 ? (
          <div className="grik-empty-state">
            <h4>Start with a clear question</h4>
            <p className="muted">Try a crop symptom, a weather timing decision, or a market planning question.</p>
          </div>
        ) : (
          activeMessages.map((message) => (
            <article key={message.id} className={`chat-bubble ${message.role}`}>
              <div className="grik-message-meta">
                <span>
                  {message.role === "assistant" ? "GRIK" : "You"} | {formatTime(message.created_at)}
                </span>
                <div className="grik-inline-actions">
                  {message.role === "assistant" && message.source_confidence != null ? (
                    <span className="grik-confidence">{Math.round(message.source_confidence * 100)}% grounded</span>
                  ) : null}
                  {message.role === "assistant" ? (
                    <>
                      <button
                        className={`btn ghost tiny grik-icon-btn ${playingMessageId === message.id ? "is-active" : ""}`}
                        type="button"
                        onClick={() => void onPlayAssistantAudio(message)}
                        disabled={ttsBusyMessageId != null && ttsBusyMessageId !== message.id}
                        title={playingMessageId === message.id ? "Stop voice playback" : "Play voice response"}
                        aria-label={playingMessageId === message.id ? "Stop voice playback" : "Play voice response"}
                      >
                        <Icon name={playingMessageId === message.id ? "pause" : "play"} size={12} />
                      </button>
                      {playingMessageId === message.id ? (
                        <span className="grik-speaking-indicator" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  <button className="btn ghost tiny grik-icon-btn" type="button" onClick={() => void onCopyMessage(message.message)} title="Copy message" aria-label="Copy message">
                    <Icon name="copy" size={12} />
                  </button>
                </div>
              </div>

              <div className="grik-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.message}</ReactMarkdown>
              </div>

              {renderMediaAnalysis(message)}

              {message.citations && message.citations.length > 0 ? (
                <div className="grik-citation-row">
                  {message.citations.slice(0, 4).map((citation, index) =>
                    citation.url ? (
                      <a
                        key={`${message.id}-${citation.source_id ?? citation.title ?? "citation"}-${index}`}
                        className="grik-citation-pill"
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {formatCitation(citation)}
                      </a>
                    ) : (
                      <span key={`${message.id}-${citation.source_id ?? citation.title ?? "citation"}-${index}`} className="grik-citation-pill">
                        {formatCitation(citation)}
                      </span>
                    )
                  )}
                </div>
              ) : null}

              {message.follow_ups && message.follow_ups.length > 0 ? (
                <div className="grik-followups-row">
                  {message.follow_ups.map((followUp) => (
                    <button
                      key={`${message.id}-${followUp}`}
                      type="button"
                      className="btn ghost small"
                      disabled={sending || mediaBusy || sttBusy || isRecording || realtimeListening}
                      onClick={() => void onAskFollowUp(followUp)}
                    >
                      {followUp}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))
        )}

        {sending ? (
          <article className="chat-bubble assistant">
            <div className="grik-message-meta">
              <span>GRIK | now</span>
            </div>
            <p>Reviewing your question and preparing the next action plan.</p>
          </article>
        ) : null}
        <div ref={messageEndRef} />
      </div>
    </>
  );
}

export function FarmerBrainRealtimeModal({
  open,
  realtimePhase,
  realtimePhaseLabel,
  realtimeConnected,
  realtimeListening,
  realtimeConnecting,
  realtimeAudioLevel,
  realtimePartialTranscript,
  realtimeAssistantCue,
  realtimeError,
  realtimeNeedsConversationChoice,
  realtimePrimaryActionLabel,
  realtimeRecentAssistantText,
  realtimeSessionFacts,
  voiceProfile,
  voiceOptions,
  selectedVoiceDetail,
  disableVoiceProfile,
  sending,
  mediaBusy,
  sttBusy,
  isRecording,
  onClose,
  onVoiceProfileChange,
  onChoosePath,
  onToggleCapture,
}: RealtimeModalProps) {
  if (!open) return null;

  return (
    <div className="grik-realtime-overlay" onClick={onClose}>
      <div className="grik-realtime-modal" role="dialog" aria-modal="true" aria-label="Realtime GRIK voice assistant" onClick={(event) => event.stopPropagation()}>
        <div className="grik-realtime-head">
          <div>
            <div className="label">GRIK Live Voice</div>
            <h3>Realtime assistant</h3>
            <p className="muted grik-realtime-note">Hands-free guidance for farm decisions.</p>
          </div>
          <button className="btn ghost tiny grik-icon-btn" type="button" onClick={onClose} title="End realtime live session" aria-label="End realtime live session">
            <Icon name="stop" size={13} />
          </button>
        </div>

        <div className={`grik-realtime-phase-pill phase-${realtimePhase}`}>
          <span className="grik-realtime-dot" aria-hidden="true" />
          <strong>{realtimePhaseLabel}</strong>
          <span>{realtimeConnected ? "Connected" : "Disconnected"}</span>
        </div>

        <div className="grik-realtime-config-row">
          <label className="grik-realtime-config-field">
            Voice profile
            <select value={voiceProfile} onChange={(event) => onVoiceProfileChange(event.target.value)} disabled={disableVoiceProfile}>
              {voiceOptions.map((profileOption) => (
                <option key={profileOption.id} value={profileOption.id}>
                  {profileOption.label}
                </option>
              ))}
            </select>
          </label>
          <span className="muted grik-realtime-note">{selectedVoiceDetail}</span>
        </div>

        <div className="grik-realtime-fact-row">
          {realtimeSessionFacts.map((fact) => (
            <span key={fact} className="grik-realtime-fact-pill">
              {fact}
            </span>
          ))}
        </div>

        <div className="grik-realtime-summary-grid">
          <article className="grik-realtime-summary-card">
            <span className="label">Session</span>
            <strong>{realtimePhaseLabel}</strong>
            <p>{realtimeConnected ? "Connection is live and ready for your next turn." : "Opening a live voice connection."}</p>
          </article>
          <article className="grik-realtime-summary-card">
            <span className="label">Your turn</span>
            <strong>{realtimeListening ? "Speak naturally" : "Tap speak to begin"}</strong>
            <p>{realtimeListening ? "Pause briefly and GRIK will auto-send your turn." : "Use short, direct questions for faster replies."}</p>
          </article>
          <article className="grik-realtime-summary-card">
            <span className="label">Last reply</span>
            <strong>{realtimeRecentAssistantText ? "Available" : "Waiting"}</strong>
            <p>{realtimeRecentAssistantText ? realtimeRecentAssistantText.slice(0, 110) : "The next spoken reply will appear here as text context."}</p>
          </article>
        </div>

        <div className={`grik-realtime-visual phase-${realtimePhase}`}>
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <div className="grik-realtime-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(realtimeAudioLevel * 100)}>
          <div className="grik-realtime-meter-track">
            <div className="grik-realtime-meter-fill" style={{ width: `${Math.round(realtimeAudioLevel * 100)}%` }} />
          </div>
          <span className="grik-realtime-meter-label">Mic {Math.round(realtimeAudioLevel * 100)}%</span>
        </div>

        <div className="grik-realtime-livefeed">
          <article className={`grik-realtime-live-row user ${realtimeListening ? "active" : ""}`}>
            <span className="grik-realtime-live-role">You</span>
            <p>{realtimePartialTranscript || (realtimeListening ? "Listening... say your question naturally." : "Tap Speak and ask naturally.")}</p>
          </article>
          <article className={`grik-realtime-live-row ai ${realtimePhase === "waiting" || realtimePhase === "speaking" || realtimePhase === "greeting" ? "active" : ""}`}>
            <span className="grik-realtime-live-role">GRIK</span>
            <p>{realtimeAssistantCue}</p>
          </article>
        </div>

        {realtimeError ? <p className="status error">{realtimeError}</p> : null}

        {realtimeNeedsConversationChoice ? (
          <div className="grik-realtime-choice-panel">
            <div className="grik-realtime-choice-copy">
              <div className="label">Conversation choice</div>
              <h4>Pick how live voice should continue</h4>
              <p className="muted grik-realtime-note">Keep previous context for follow-up diagnosis, or start clean for a new issue.</p>
            </div>
            <div className="grik-realtime-choice-grid">
              <button className="grik-realtime-choice-card" type="button" onClick={() => onChoosePath("continue")}>
                <strong>Continue previous</strong>
                <span>Use earlier chat context and continue the current line of advice.</span>
              </button>
              <button className="grik-realtime-choice-card alt" type="button" onClick={() => onChoosePath("new")}>
                <strong>Start new</strong>
                <span>Open a clean live session for a different crop issue or question.</span>
              </button>
            </div>
          </div>
        ) : null}

        <div className="grik-realtime-action-row">
          <button
            className={`btn small ${realtimeListening ? "ghost" : ""}`}
            type="button"
            onClick={onToggleCapture}
            disabled={realtimeConnecting || realtimePhase === "greeting" || sending || mediaBusy || sttBusy || isRecording}
          >
            <Icon name={realtimeListening ? "pause" : "voice"} size={14} />
            {realtimePrimaryActionLabel}
          </button>
          <button className="btn ghost small" type="button" onClick={onClose}>
            End session
          </button>
        </div>

        <div className="grik-realtime-help">
          <p className="muted grik-realtime-note">GRIK auto-sends after a short pause and restarts listening after each response.</p>
          <p className="muted grik-realtime-note">If voice playback fails, read the text reply and tap Speak again for the next turn.</p>
        </div>
      </div>
    </div>
  );
}
