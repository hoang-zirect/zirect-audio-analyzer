import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import {
  analyzePair,
  BAND_DEFINITIONS,
  Finding,
  formatTimestamp,
  PairAnalysis,
} from "./audio-analysis";
import { GlassButton } from "./components/GlassButton";

type Slot = "demo" | "reference";
type View = "new" | "report";
type ReportTab = "overview" | "stereo" | "eq" | "melody" | "arrangement" | "dynamics" | "priority" | "feedback";

type SelectedAudio = {
  file: File;
  duration?: number;
  sampleRate?: number;
  channels?: number;
};

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["wav", "flac", "mp3", "m4a", "aac", "ogg", "opus"];

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDuration = (seconds?: number) => {
  if (seconds === undefined || !Number.isFinite(seconds)) return "Reading duration";
  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const rest = (roundedSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
};

const signed = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("The browser did not allow automatic copying.");
}

export default function Home() {
  const [demo, setDemo] = useState<SelectedAudio | null>(null);
  const [reference, setReference] = useState<SelectedAudio | null>(null);
  const [dragging, setDragging] = useState<Slot | null>(null);
  const [previewing, setPreviewing] = useState<Slot | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Slot, string>>>({});
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [view, setView] = useState<View>("new");
  const [analysis, setAnalysis] = useState<PairAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ value: 0, label: "Preparing analysis" });
  const demoInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  const validateFile = (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      return "Unsupported format. Use WAV, FLAC, MP3, M4A, AAC, OGG, or OPUS.";
    }
    if (file.size > MAX_FILE_SIZE) return "The file exceeds the 500 MB limit.";
    return null;
  };

  const setSlotFile = (slot: Slot, file: File) => {
    const error = validateFile(file);
    setErrors((current) => ({ ...current, [slot]: error ?? undefined }));
    if (error) return;
    const next = { file };
    if (slot === "demo") setDemo(next);
    else setReference(next);
    setPreviewing(null);
    setAnalysis(null);
    setAnalysisError(null);
  };

  const onInput = (slot: Slot, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setSlotFile(slot, file);
    event.target.value = "";
  };

  const onDrop = (slot: Slot, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(null);
    const file = event.dataTransfer.files?.[0];
    if (file) setSlotFile(slot, file);
  };

  const removeFile = (slot: Slot) => {
    if (slot === "demo") setDemo(null);
    else setReference(null);
    setPreviewing(null);
    setErrors((current) => ({ ...current, [slot]: undefined }));
    setAnalysis(null);
    setAnalysisError(null);
  };

  const runAnalysis = async () => {
    if (!demo || !reference || analyzing) return;
    setPreviewing(null);
    setAnalyzing(true);
    setAnalysisError(null);
    setProgress({ value: 1, label: "Preparing the measurement engine" });
    try {
      const result = await analyzePair(demo.file, reference.file, (value, label) => {
        setProgress({ value, label });
      });
      setAnalysis(result);
      setDemo((current) => current ? ({ ...current, duration: result.demo.meta.duration, sampleRate: result.demo.meta.analysisSampleRate, channels: result.demo.meta.channels }) : current);
      setReference((current) => current ? ({ ...current, duration: result.reference.meta.duration, sampleRate: result.reference.meta.analysisSampleRate, channels: result.reference.meta.channels }) : current);
      setView("report");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The file could not be analyzed.";
      setAnalysisError(`One of the files could not be decoded or measured: ${message}. Try a clean WAV or FLAC export and run the analysis again.`);
    } finally {
      setAnalyzing(false);
    }
  };

  const fileReady = Boolean(demo && reference);

  return (
    <main className={`app-shell ${view === "report" ? "report-view" : "new-view"}`}>
      <AppHeader view={view} hasReport={Boolean(analysis)} onNew={() => setView("new")} onReport={() => analysis && setView("report")} />
      <section className="workspace">
        {view === "new" ? (
          <UploadWorkspace
            demo={demo}
            reference={reference}
            errors={errors}
            analysisError={analysisError}
            dragging={dragging}
            previewing={previewing}
            fileReady={fileReady}
            hasReport={Boolean(analysis)}
            analyzing={analyzing}
            demoInput={demoInput}
            referenceInput={referenceInput}
            onInput={onInput}
            onDrop={onDrop}
            onDrag={setDragging}
            onPreview={setPreviewing}
            onRemove={removeFile}
            onAnalyze={runAnalysis}
            onOpenReport={() => setView("report")}
          />
        ) : analysis && demo && reference ? (
          <ReportWorkspace analysis={analysis} demoFile={demo.file} referenceFile={reference.file} onNew={() => setView("new")} />
        ) : null}

        {analyzing ? <AnalysisProgress progress={progress.value} label={progress.label} /> : null}
      </section>
    </main>
  );
}

function AppHeader({ view, hasReport, onNew, onReport }: { view: View; hasReport: boolean; onNew: () => void; onReport: () => void }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <GlassButton className="site-brand" contentClassName="site-brand-content" size="default" variant="neutral" type="button" onClick={onNew} aria-label="Open a new analysis">
          <strong>ZIRECT</strong>
          <span>AUDIO ANALYZER</span>
        </GlassButton>
        <nav className="header-nav" aria-label="Primary navigation">
          <GlassButton className={`header-new-analysis ${view === "new" ? "active" : ""}`} size="default" variant="secondary" type="button" onClick={onNew} aria-current={view === "new" ? "page" : undefined}>New Analysis</GlassButton>
          <GlassButton className={`header-report-button ${view === "report" ? "active" : ""}`} size="default" variant="secondary" type="button" disabled={!hasReport} onClick={onReport} aria-current={view === "report" ? "page" : undefined}>Analysis Report</GlassButton>
        </nav>
      </div>
    </header>
  );
}

type UploadWorkspaceProps = {
  demo: SelectedAudio | null;
  reference: SelectedAudio | null;
  errors: Partial<Record<Slot, string>>;
  analysisError: string | null;
  dragging: Slot | null;
  previewing: Slot | null;
  fileReady: boolean;
  hasReport: boolean;
  analyzing: boolean;
  demoInput: React.RefObject<HTMLInputElement | null>;
  referenceInput: React.RefObject<HTMLInputElement | null>;
  onInput: (slot: Slot, event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (slot: Slot, event: DragEvent<HTMLElement>) => void;
  onDrag: (slot: Slot | null) => void;
  onPreview: (slot: Slot | null) => void;
  onRemove: (slot: Slot) => void;
  onAnalyze: () => void;
  onOpenReport: () => void;
};

function UploadWorkspace(props: UploadWorkspaceProps) {
  return (
    <>
      <div className="content upload-content">
        <section className="upload-hero">
          <div className="upload-hero-copy">
            <p className="eyebrow">ZIRECT LABEL · AUDIO QUALITY CONTROL</p>
            <h1>Compare Your Demo Against a Reference</h1>
            <p className="hero-description">Loudness-matched analysis of stereo image, phase, tonal balance, dynamics, and musical structure, designed for Deep Sleep, Ambient Sleep, and Calm Piano.</p>
            <div className="privacy-badges" aria-label="Processing and privacy information">
              <span><i />Browser-Based Processing</span>
              <span><i />Audio Never Leaves Your Device</span>
              <span><i />Automatic Loudness Matching</span>
            </div>
          </div>
        </section>

        <section className="upload-grid" aria-label="Upload Demo and Reference tracks">
          <UploadCard slot="demo" title="Demo Track" audio={props.demo} error={props.errors.demo} active={props.dragging === "demo"} previewing={props.previewing} inputRef={props.demoInput} onInput={props.onInput} onDrop={props.onDrop} onDrag={props.onDrag} onPreview={props.onPreview} onRemove={props.onRemove} />
          <UploadCard slot="reference" title="Reference Track" audio={props.reference} error={props.errors.reference} active={props.dragging === "reference"} previewing={props.previewing} inputRef={props.referenceInput} onInput={props.onInput} onDrop={props.onDrop} onDrag={props.onDrag} onPreview={props.onPreview} onRemove={props.onRemove} />
        </section>

        <section className={`analysis-cta ${props.fileReady ? "ready" : ""}`} aria-label="Start audio analysis">
          <div className="analysis-readiness"><span /><b>{props.fileReady ? "Both tracks are ready" : "Both tracks are required before analysis can begin."}</b></div>
          <GlassButton
            className="start-analysis-button"
            contentClassName="start-analysis-content"
            size="lg"
            variant="primary"
            type="button"
            onClick={props.onAnalyze}
            disabled={!props.fileReady || props.analyzing}
            loading={props.analyzing}
          >
            <span>{props.analyzing ? "Analyzing" : "Start Analysis"}</span><i className="start-analysis-arrow" aria-hidden="true">→</i>
          </GlassButton>
          <p><span>i</span>Hz and dB values are starting points for critical listening.</p>
        </section>

        {props.analysisError ? <div className="analysis-error" role="alert"><b>Analysis could not be completed</b><span>{props.analysisError}</span></div> : null}
        {props.hasReport ? <GlassButton className="resume-report" contentClassName="resume-report-content" size="default" variant="primary" type="button" onClick={props.onOpenReport}>Open the latest analysis report <span>→</span></GlassButton> : null}

        <section className="scope-panel">
          <div className="scope-title">ANALYSIS SCOPE</div>
          <div className="scope-grid">
            <ScopeItem icon="lufs" label="LUFS" />
            <ScopeItem icon="stereo" label="Stereo" />
            <ScopeItem icon="phase" label="Phase" />
            <ScopeItem icon="eq" label="EQ" />
            <ScopeItem icon="dynamics" label="Dynamics" />
          </div>
        </section>
      </div>
    </>
  );
}

type UploadCardProps = {
  slot: Slot;
  title: string;
  audio: SelectedAudio | null;
  error?: string;
  active: boolean;
  previewing: Slot | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInput: (slot: Slot, event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (slot: Slot, event: DragEvent<HTMLElement>) => void;
  onDrag: (slot: Slot | null) => void;
  onPreview: (slot: Slot | null) => void;
  onRemove: (slot: Slot) => void;
};

function UploadCard({ slot, title, audio, error, active, previewing, inputRef, onInput, onDrop, onDrag, onPreview, onRemove }: UploadCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const previewAudio = useRef<HTMLAudioElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDuration, setPreviewDuration] = useState<number>();
  const [previewPosition, setPreviewPosition] = useState(0);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setPreviewDuration(undefined);
    setPreviewPosition(0);
    if (!audio) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(audio.file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [audio?.file]);

  useEffect(() => {
    setFullscreenSupported(Boolean(document.fullscreenEnabled && cardRef.current?.requestFullscreen));
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    if (previewing !== slot) previewAudio.current?.pause();
  }, [previewing, slot]);

  const chooseFile = () => inputRef.current?.click();

  const handleCardClick = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, input, audio")) return;
    chooseFile();
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    chooseFile();
  };

  const togglePreview = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const player = previewAudio.current;
    if (!player) return;
    if (previewing === slot && !player.paused) {
      player.pause();
      onPreview(null);
      return;
    }
    try {
      onPreview(slot);
      await player.play();
    } catch {
      onPreview(null);
    }
  };

  const replaceFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    previewAudio.current?.pause();
    onPreview(null);
    chooseFile();
  };

  const seekPreview = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const nextPosition = Number(event.target.value);
    setPreviewPosition(nextPosition);
    if (previewAudio.current) previewAudio.current.currentTime = nextPosition;
  };

  const toggleFullscreen = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!cardRef.current || !fullscreenSupported) return;
    try {
      if (document.fullscreenElement === cardRef.current) await document.exitFullscreen();
      else await cardRef.current.requestFullscreen();
    } catch {
      setFullscreen(false);
    }
  };

  const extension = audio?.file.name.split(".").pop()?.toUpperCase() || "AUDIO";
  const duration = audio?.duration ?? previewDuration;
  const isPlaying = previewing === slot;

  return (
    <article
      ref={cardRef}
      className={`upload-card ${slot} ${active ? "dragging" : ""} ${audio ? "selected" : "empty"}`}
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      onDragEnter={(event) => { event.preventDefault(); onDrag(slot); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onDrag(null); }}
      onDrop={(event) => onDrop(slot, event)}
      aria-label={`${title}. ${audio ? `Selected file: ${audio.file.name}` : "No file selected"}`}
    >
      <input className="upload-input" ref={inputRef} type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg,.opus" onChange={(event) => onInput(slot, event)} aria-label={`Choose a file for ${title}`} />
      <header className="upload-card-header">
        <div className="upload-card-heading"><span className="upload-status-dot" /><h2>{title}</h2></div>
        {fullscreenSupported ? (
          <GlassButton className={`expand-card glass-button-tone-${slot}`} size="icon" variant="neutral" type="button" onClick={toggleFullscreen} aria-label={fullscreen ? `Exit fullscreen for ${title}` : `Open ${title} in fullscreen`}>
            <span className="expand-icon" aria-hidden="true"><i /><i /><i /><i /></span>
          </GlassButton>
        ) : null}
      </header>

      <div className="upload-card-body">
        {audio ? (
          <div className="selected-file-info">
            <span className="file-format">{extension}</span>
            <h3 title={audio.file.name}>{audio.file.name}</h3>
            <div className="file-metadata">
              <span>{extension}</span><i /><span>{formatBytes(audio.file.size)}</span><i /><span>{duration ? formatDuration(duration) : "Reading duration"}</span>
              {audio.sampleRate ? <><i /><span>{audio.sampleRate / 1000} kHz · {audio.channels === 1 ? "Mono" : "Stereo"}</span></> : null}
            </div>
            <GlassButton className={`replace-file glass-button-tone-${slot}`} size="sm" variant="neutral" type="button" onClick={replaceFile}>Replace File</GlassButton>
          </div>
        ) : (
          <div className="upload-empty-copy">
            <span className="upload-glyph" aria-hidden="true"><i /></span>
            <h3>{slot === "demo" ? "Upload Demo Track" : "Upload Reference Track"}</h3>
            <p>Drop a WAV, MP3, or FLAC file here</p>
            <span className="upload-browse">or click to browse</span>
            <small className="upload-quality-note">Higher-quality source files provide more reliable measurements.</small>
          </div>
        )}
        {error ? <div className="file-error" role="alert">{error}</div> : null}
      </div>

      {audio ? (
        <footer className="upload-card-footer">
          <GlassButton className={`upload-play glass-button-tone-${slot} ${isPlaying ? "playing" : ""}`} size="icon" variant="primary" type="button" onClick={togglePreview} disabled={!previewUrl} aria-label={isPlaying ? `Pause ${audio.file.name}` : `Preview ${audio.file.name}`}>
            <span className="play-button-glyph" aria-hidden="true">{isPlaying ? <><i /><i /></> : <b />}</span>
          </GlassButton>
          <div className="upload-preview-track">
            <div className="upload-file-state"><span className="upload-status-dot" /><b>{isPlaying ? "Previewing" : "Ready for analysis"}</b><em>{formatDuration(previewPosition)} / {duration ? formatDuration(duration) : "--:--"}</em></div>
            <input aria-label={`Preview position for ${audio.file.name}`} type="range" min="0" max={duration || 1} step="0.1" value={Math.min(previewPosition, duration || 1)} onChange={seekPreview} onClick={(event) => event.stopPropagation()} />
          </div>
          <GlassButton className="remove-upload" size="sm" variant="danger" type="button" onClick={(event) => { event.stopPropagation(); onRemove(slot); }} aria-label={`Remove ${audio.file.name}`}>Remove File</GlassButton>
          <audio
            ref={previewAudio}
            src={previewUrl ?? undefined}
            preload="metadata"
            onLoadedMetadata={(event) => Number.isFinite(event.currentTarget.duration) && setPreviewDuration(event.currentTarget.duration)}
            onTimeUpdate={(event) => setPreviewPosition(event.currentTarget.currentTime)}
            onPause={() => previewing === slot && onPreview(null)}
            onEnded={() => { setPreviewPosition(0); onPreview(null); }}
          />
        </footer>
      ) : null}
    </article>
  );
}

function ScopeItem({ icon, label }: { icon: string; label: string }) {
  return <div className="scope-item"><span className={`scope-icon ${icon}`} aria-hidden="true"><i /><i /><i /><i /><i /></span><span>{label}</span></div>;
}

function AnalysisProgress({ progress, label }: { progress: number; label: string }) {
  const stages = [
    { at: 3, label: "Decoding Audio" },
    { at: 12, label: "Measuring Loudness" },
    { at: 48, label: "Analyzing Stereo and Phase" },
    { at: 61, label: "Comparing Frequency Balance" },
    { at: 88, label: "Measuring Dynamics" },
    { at: 96, label: "Applying Loudness Match" },
    { at: 98, label: "Generating Findings" },
    { at: 100, label: "Analysis Complete" },
  ];
  return (
    <div className="analysis-overlay" role="dialog" aria-modal="true" aria-label="Audio analysis in progress">
      <div className="analysis-modal">
        <div className="scanner-mark"><span /><span /><span /><span /><span /></div>
        <p className="eyebrow">DSP ANALYSIS RUNNING</p>
        <h2>Analyzing Both Tracks</h2>
        <p className="progress-label">{label}</p>
        <div className="progress-track"><i style={{ width: `${Math.max(2, progress)}%` }} /></div>
        <div className="progress-value">{Math.round(progress)}%</div>
        <div className="progress-stages">
          {stages.map((stage) => <div key={stage.label} className={progress >= stage.at ? "done" : ""}><span />{stage.label}</div>)}
        </div>
        <small>Audio is processed in your browser and is never uploaded to a server.</small>
      </div>
    </div>
  );
}

function ReportWorkspace({ analysis, demoFile, referenceFile, onNew }: { analysis: PairAnalysis; demoFile: File; referenceFile: File; onNew: () => void }) {
  const [tab, setTab] = useState<ReportTab>("overview");
  const [copied, setCopied] = useState(false);

  const copyFeedback = async () => {
    try {
      await copyText(analysis.feedback.fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const tabs: Array<{ key: ReportTab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "stereo", label: "Stereo & Spatial Image" },
    { key: "eq", label: "EQ & Tonal Balance" },
    { key: "melody", label: "Melody & Motif" },
    { key: "arrangement", label: "Arrangement & Reverb" },
    { key: "dynamics", label: "Loudness & Dynamics" },
    { key: "priority", label: "Priority Ranking" },
    { key: "feedback", label: "Producer Feedback" },
  ];

  return (
    <>
      <div className="content report-content">
        <section className="report-hero">
          <div className="report-hero-copy">
            <p className="eyebrow">ANALYSIS COMPLETE / LOUDNESS-MATCHED</p>
            <h1>Demo vs Reference Analysis</h1>
            <p className="report-subtitle">{analysis.demo.meta.name} <i /> {analysis.reference.meta.name}</p>
          </div>
          <div className="report-hero-side">
            <div className={`verdict ${analysis.releaseVerdict.startsWith("Not") ? "danger" : analysis.releaseVerdict.startsWith("Revisions") ? "warning" : "pass"}`}>
              <ScoreRing score={analysis.qualityScore} />
              <div><span>RELEASE ASSESSMENT</span><strong>{analysis.releaseVerdict}</strong></div>
            </div>
            <div className="report-hero-actions">
              <GlassButton type="button" className="report-secondary-action" size="default" variant="secondary" onClick={onNew}>Replace Files / New Analysis</GlassButton>
              <GlassButton type="button" className="report-primary-action" size="default" variant="primary" onClick={tab === "feedback" ? copyFeedback : () => setTab("feedback")}>
                {tab === "feedback" ? (copied ? "Copied" : "Copy Feedback") : "Open Producer Feedback"}
              </GlassButton>
            </div>
          </div>
        </section>

        <LoudnessMatch analysis={analysis} />

        <nav className="report-tabs" aria-label="Analysis report sections">
          {tabs.map((item) => <GlassButton key={item.key} type="button" size="default" variant="neutral" className={`report-tab-button ${tab === item.key ? "active" : ""}`} onClick={() => setTab(item.key)}>{item.label}</GlassButton>)}
        </nav>

        <div className="report-body">
          {tab === "overview" ? <OverviewTab analysis={analysis} /> : null}
          {tab === "stereo" ? <StereoTab analysis={analysis} /> : null}
          {tab === "eq" ? <EqTab analysis={analysis} /> : null}
          {tab === "melody" ? <MelodyTab analysis={analysis} /> : null}
          {tab === "arrangement" ? <ArrangementTab analysis={analysis} /> : null}
          {tab === "dynamics" ? <DynamicsTab analysis={analysis} /> : null}
          {tab === "priority" ? <PriorityTab analysis={analysis} /> : null}
          {tab === "feedback" ? <FeedbackTab analysis={analysis} copied={copied} onCopy={copyFeedback} /> : null}
        </div>
        <div className="report-evidence-note"><span>i</span>Measurements and inferences are labeled separately in every finding.</div>
      </div>

      <ABPlayer analysis={analysis} demoFile={demoFile} referenceFile={referenceFile} />
    </>
  );
}

function ScoreRing({ score }: { score: number }) {
  return <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}><span>{score}</span><small>/100</small></div>;
}

function LoudnessMatch({ analysis }: { analysis: PairAnalysis }) {
  const match = analysis.loudnessMatch;
  return (
    <section className="loudness-match-panel">
      <div className="match-title"><span className="status-led" /><div><b>LOUDNESS MATCH APPLIED BEFORE COMPARISON</b><small>Both tracks are attenuated to {match.targetLufs.toFixed(1)} LUFS-I before tonal and spatial comparison</small></div></div>
      <div className="match-metrics">
        <Metric compact label="Original Demo" value={`${analysis.demo.loudness.integratedLufs.toFixed(1)} LUFS`} note={`Gain ${signed(match.demoGainDb, " dB")}`} />
        <span className="match-arrow">⇄</span>
        <Metric compact label="Original Reference" value={`${analysis.reference.loudness.integratedLufs.toFixed(1)} LUFS`} note={`Gain ${signed(match.referenceGainDb, " dB")}`} />
        <Metric compact label="Original Difference" value={`${Math.abs(match.originalDeltaDb).toFixed(1)} dB`} note={match.originalDeltaDb > 0 ? "Demo is louder" : match.originalDeltaDb < 0 ? "Reference is louder" : "Equal loudness"} />
      </div>
    </section>
  );
}

function ABPlayer({ analysis, demoFile, referenceFile }: { analysis: PairAnalysis; demoFile: File; referenceFile: File }) {
  const demoAudio = useRef<HTMLAudioElement>(null);
  const referenceAudio = useRef<HTMLAudioElement>(null);
  const [urls, setUrls] = useState<{ demo: string; reference: string } | null>(null);
  const [selected, setSelected] = useState<Slot>("demo");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const duration = Math.min(analysis.demo.meta.duration, analysis.reference.meta.duration);

  useEffect(() => {
    const nextUrls = { demo: URL.createObjectURL(demoFile), reference: URL.createObjectURL(referenceFile) };
    setUrls(nextUrls);
    setSelected("demo");
    setPlaying(false);
    setPosition(0);
    return () => {
      demoAudio.current?.pause();
      referenceAudio.current?.pause();
      URL.revokeObjectURL(nextUrls.demo);
      URL.revokeObjectURL(nextUrls.reference);
    };
  }, [demoFile, referenceFile]);

  useEffect(() => {
    if (demoAudio.current) demoAudio.current.volume = Math.min(1, 10 ** (analysis.loudnessMatch.demoGainDb / 20));
    if (referenceAudio.current) referenceAudio.current.volume = Math.min(1, 10 ** (analysis.loudnessMatch.referenceGainDb / 20));
  }, [analysis]);

  const getPlayer = (slot: Slot) => slot === "demo" ? demoAudio.current : referenceAudio.current;

  const syncPlayerPosition = (player: HTMLAudioElement, value: number) => {
    const playerDuration = Number.isFinite(player.duration) ? player.duration : duration;
    player.currentTime = Math.min(value, Math.max(0, playerDuration - 0.1));
  };

  const togglePlayback = async () => {
    const target = getPlayer(selected);
    if (!target) return;
    if (playing && !target.paused) {
      target.pause();
      setPlaying(false);
      return;
    }
    try {
      syncPlayerPosition(target, position);
      await target.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  const selectSource = async (slot: Slot) => {
    if (slot === selected) return;
    const current = getPlayer(selected);
    const target = getPlayer(slot);
    const resumeAfterSwitch = playing;
    current?.pause();
    setSelected(slot);
    if (!target) {
      setPlaying(false);
      return;
    }
    syncPlayerPosition(target, position);
    if (!resumeAfterSwitch) return;
    try {
      await target.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  const seek = (value: number) => {
    setPosition(value);
    if (demoAudio.current) demoAudio.current.currentTime = Math.min(value, demoAudio.current.duration || value);
    if (referenceAudio.current) referenceAudio.current.currentTime = Math.min(value, referenceAudio.current.duration || value);
  };

  return (
    <section className="ab-player-dock" aria-label="Demo and Reference comparison player">
      <div className="ab-player-inner">
        <div className="ab-dock-label"><span>A/B</span><div><b>LOUDNESS-MATCHED</b><small>{analysis.loudnessMatch.targetLufs.toFixed(1)} LUFS-I · local playback</small></div></div>
        <GlassButton className={`ab-master-play glass-button-tone-${selected} ${playing ? "playing" : ""}`} size="icon" variant="primary" type="button" onClick={togglePlayback} aria-label={playing ? "Pause the A/B player" : "Play the A/B player"}>
          <span className="play-button-glyph" aria-hidden="true">{playing ? <><i /><i /></> : <b />}</span>
        </GlassButton>
        <div className="ab-source-toggle" aria-label="Select the playback source">
          <GlassButton type="button" size="default" variant="neutral" className={`demo glass-button-tone-demo ${selected === "demo" ? "active" : ""}`} contentClassName="ab-source-content" onClick={() => selectSource("demo")}><span>Demo</span><small>{signed(analysis.loudnessMatch.demoGainDb, " dB")}</small></GlassButton>
          <GlassButton type="button" size="default" variant="neutral" className={`reference glass-button-tone-reference ${selected === "reference" ? "active" : ""}`} contentClassName="ab-source-content" onClick={() => selectSource("reference")}><span>Reference</span><small>{signed(analysis.loudnessMatch.referenceGainDb, " dB")}</small></GlassButton>
        </div>
        <div className="ab-dock-timeline">
          <input aria-label="A/B playback position" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} onChange={(event) => seek(Number(event.target.value))} />
          <div><span>{selected === "demo" ? "DEMO TRACK" : "REFERENCE TRACK"}</span><time>{formatTimestamp(position)} / {formatTimestamp(duration)}</time></div>
        </div>
        <audio ref={demoAudio} src={urls?.demo} preload="metadata" onTimeUpdate={(event) => selected === "demo" && setPosition(event.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setPosition(0); }} />
        <audio ref={referenceAudio} src={urls?.reference} preload="metadata" onTimeUpdate={(event) => selected === "reference" && setPosition(event.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setPosition(0); }} />
      </div>
    </section>
  );
}

function OverviewTab({ analysis }: { analysis: PairAnalysis }) {
  return (
    <div className="report-stack">
      <ReportMetricOverview analysis={analysis} />
      <section className="summary-grid">
        <article className="report-panel strengths-panel"><PanelHeading index="01" title="Demo Strengths" subtitle="Elements worth preserving" />
          <ul className="strength-list">{analysis.strengths.map((item) => <li key={item}><span>✓</span>{item}</li>)}</ul>
        </article>
        <article className="report-panel differences-panel"><PanelHeading index="02" title="Three Largest Differences" subtitle="Ordered by priority" />
          <ol className="difference-list">{analysis.threeBiggestDifferences.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol>
        </article>
      </section>

      <section className="report-panel"><PanelHeading index="03" title="Highest-Priority Findings" subtitle={`${analysis.findings.length} evidence-based findings`} />
        <div className="finding-list">{analysis.findings.slice(0, 7).map((finding, index) => <FindingCard key={finding.id} finding={finding} rank={index + 1} />)}</div>
      </section>

      {analysis.referenceWarnings.length ? <section className="report-panel reference-warning"><PanelHeading index="REF" title="Reference Issues Not to Replicate" subtitle="Preserve technically stronger elements in the Demo" />
        <div className="finding-list">{analysis.referenceWarnings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div>
      </section> : null}
    </div>
  );
}

function ReportMetricOverview({ analysis }: { analysis: PairAnalysis }) {
  const metrics = [
    { label: "Integrated LUFS", value: analysis.demo.loudness.integratedLufs.toFixed(1), unit: "LUFS", reference: `${analysis.reference.loudness.integratedLufs.toFixed(1)} LUFS`, tone: "demo" },
    { label: "Loudness Difference", value: Math.abs(analysis.loudnessMatch.originalDeltaDb).toFixed(1), unit: "dB", reference: analysis.loudnessMatch.originalDeltaDb > 0 ? "Demo louder" : analysis.loudnessMatch.originalDeltaDb < 0 ? "Reference louder" : "Equal", tone: "neutral" },
    { label: "True Peak", value: analysis.demo.loudness.truePeakDbtp.toFixed(1), unit: "dBTP", reference: `${analysis.reference.loudness.truePeakDbtp.toFixed(1)} dBTP`, tone: analysis.demo.loudness.truePeakDbtp > -1 ? "warning" : "demo" },
    { label: "LRA", value: analysis.demo.loudness.lraLu.toFixed(1), unit: "LU", reference: `${analysis.reference.loudness.lraLu.toFixed(1)} LU`, tone: "neutral" },
    { label: "Crest Factor", value: analysis.demo.loudness.crestFactorDb.toFixed(1), unit: "dB", reference: `${analysis.reference.loudness.crestFactorDb.toFixed(1)} dB`, tone: "neutral" },
    { label: "Phase Correlation", value: analysis.demo.stereo.correlation.toFixed(2), unit: "", reference: analysis.reference.stereo.correlation.toFixed(2), tone: analysis.demo.stereo.correlation < 0.1 ? "warning" : "demo" },
    { label: "Mono Compatibility", value: analysis.demo.stereo.monoRetentionDb.toFixed(1), unit: "dB", reference: `${analysis.reference.stereo.monoRetentionDb.toFixed(1)} dB`, tone: analysis.demo.stereo.monoRetentionDb < -4 ? "warning" : "demo" },
    { label: "Stereo Width", value: analysis.demo.stereo.widthPercent.toFixed(0), unit: "%", reference: `${analysis.reference.stereo.widthPercent.toFixed(0)}%`, tone: "demo" },
  ];
  return (
    <section className="report-metric-overview" aria-label="Demo overview metrics compared with the Reference">
      {metrics.map((metric) => (
        <article className={`report-metric-card ${metric.tone}`} key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}<small>{metric.unit}</small></strong>
          <p>Reference <b>{metric.reference}</b></p>
        </article>
      ))}
    </section>
  );
}

function StereoTab({ analysis }: { analysis: PairAnalysis }) {
  const rows = [
    { label: "Overall", range: "Full range", demo: analysis.demo.stereo, reference: analysis.reference.stereo },
    ...BAND_DEFINITIONS.map((definition) => ({ label: definition.label, range: definition.range, demo: analysis.demo.spectral.bands[definition.key], reference: analysis.reference.spectral.bands[definition.key] })),
  ];
  return (
    <div className="report-stack">
      <section className="metric-grid four">
        <Metric label="Demo width" value={`${analysis.demo.stereo.widthPercent.toFixed(0)}%`} note={`Reference ${analysis.reference.stereo.widthPercent.toFixed(0)}%`} />
        <Metric label="Correlation" value={analysis.demo.stereo.correlation.toFixed(2)} note={`Reference ${analysis.reference.stereo.correlation.toFixed(2)}`} tone={analysis.demo.stereo.correlation < 0.1 ? "bad" : "good"} />
        <Metric label="Mono retention" value={`${analysis.demo.stereo.monoRetentionDb.toFixed(1)} dB`} note={`Reference ${analysis.reference.stereo.monoRetentionDb.toFixed(1)} dB`} tone={analysis.demo.stereo.monoRetentionDb < -4 ? "bad" : "good"} />
        <Metric label="L/R balance" value={`${signed(analysis.demo.stereo.balanceDb, " dB")}`} note={analysis.demo.stereo.balanceDb > 0 ? "Leans left" : analysis.demo.stereo.balanceDb < 0 ? "Leans right" : "Balanced"} />
      </section>
      <section className="report-panel"><PanelHeading index="01" title="Stereo Image by Frequency Band" subtitle="Per-band measurements after decoding" />
        <div className="data-table stereo-table"><div className="table-row table-head"><span>Band</span><span>Demo width</span><span>Ref width</span><span>Demo corr.</span><span>Ref corr.</span></div>
          {rows.map((row) => <div className="table-row" key={row.label}><span><b>{row.label}</b><small>{row.range}</small></span><span>{row.demo.widthPercent.toFixed(0)}%</span><span>{row.reference.widthPercent.toFixed(0)}%</span><span className={row.demo.correlation < 0 ? "negative" : ""}>{row.demo.correlation.toFixed(2)}</span><span className={row.reference.correlation < 0 ? "negative" : ""}>{row.reference.correlation.toFixed(2)}</span></div>)}
        </div>
      </section>
      <section className="report-panel"><PanelHeading index="02" title="Stereo & Spatial Findings" subtitle="Phase, width, balance, and mono compatibility" /><RelevantFindings analysis={analysis} sections={["Stereo & Spatial Image"]} /></section>
    </div>
  );
}

function EqTab({ analysis }: { analysis: PairAnalysis }) {
  return (
    <div className="report-stack">
      <section className="report-panel spectrum-panel"><PanelHeading index="01" title="Average Spectrum" subtitle="Demo and Reference average curves after loudness matching" /><SpectrumChart analysis={analysis} /></section>
      <section className="report-panel"><PanelHeading index="02" title="Frequency-Band Differences" subtitle="Positive values mean more energy in the Demo" /><BandDeltaChart analysis={analysis} /></section>
      <section className="report-panel"><PanelHeading index="03" title="EQ & Tonal Balance Findings" subtitle="Suggested source, bus, or master adjustments" /><RelevantFindings analysis={analysis} sections={["EQ & Tonal Balance", "File Quality"]} /></section>
    </div>
  );
}

function MelodyTab({ analysis }: { analysis: PairAnalysis }) {
  return (
    <div className="report-stack">
      <section className="report-panel"><PanelHeading index="01" title="Melody & Motif" subtitle="Foreground movement, note density, and perceived prominence" /><RelevantFindings analysis={analysis} sections={["Melody & Motif"]} /></section>
      <section className="report-panel context-panel"><PanelHeading index="NOTE" title="Interpretation Context" subtitle="Stereo mix measurements cannot identify individual instruments with certainty" /><p>Onset density and midrange prominence are measured directly. Instrument, motif, and performance references are labeled as inferences and should be confirmed by listening at the detected timestamps.</p></section>
    </div>
  );
}

function ArrangementTab({ analysis }: { analysis: PairAnalysis }) {
  return (
    <div className="report-stack">
      <section className="report-panel"><PanelHeading index="01" title="Arrangement & Reverb" subtitle="Layer density, spectral buildup, and spatial tails" /><RelevantFindings analysis={analysis} sections={["Arrangement & Reverb"]} /></section>
      <section className="report-panel context-panel"><PanelHeading index="NOTE" title="Mix Context" subtitle="Recommendations prioritize track or bus changes before master processing" /><p>Reverb and arrangement conclusions combine measured tonal, spatial, and motion evidence. Confirm the likely source in the session before applying an adjustment.</p></section>
    </div>
  );
}

function DynamicsTab({ analysis }: { analysis: PairAnalysis }) {
  const metrics = [
    ["Integrated loudness", `${analysis.demo.loudness.integratedLufs.toFixed(1)} LUFS`, `${analysis.reference.loudness.integratedLufs.toFixed(1)} LUFS`],
    ["Estimated 4× true peak", `${analysis.demo.loudness.truePeakDbtp.toFixed(1)} dBTP`, `${analysis.reference.loudness.truePeakDbtp.toFixed(1)} dBTP`],
    ["Loudness range", `${analysis.demo.loudness.lraLu.toFixed(1)} LU`, `${analysis.reference.loudness.lraLu.toFixed(1)} LU`],
    ["Crest factor", `${analysis.demo.loudness.crestFactorDb.toFixed(1)} dB`, `${analysis.reference.loudness.crestFactorDb.toFixed(1)} dB`],
    ["RMS", `${analysis.demo.loudness.rmsDbfs.toFixed(1)} dBFS`, `${analysis.reference.loudness.rmsDbfs.toFixed(1)} dBFS`],
    ["Onset proxy", `${analysis.demo.motion.onsetProxyPerMinute.toFixed(1)}/min`, `${analysis.reference.motion.onsetProxyPerMinute.toFixed(1)}/min`],
    ["Final 100 ms", `${analysis.demo.motion.outroEndDb.toFixed(1)} dBFS`, `${analysis.reference.motion.outroEndDb.toFixed(1)} dBFS`],
  ];
  return (
    <div className="report-stack">
      <section className="report-panel"><PanelHeading index="01" title="Loudness & Dynamic Range" subtitle="Loudness is not used as a substitute for quality" />
        <div className="data-table dynamics-table"><div className="table-row table-head"><span>Metric</span><span>Demo</span><span>Reference</span></div>{metrics.map(([label, demo, reference]) => <div className="table-row" key={label}><span>{label}</span><span>{demo}</span><span>{reference}</span></div>)}</div>
      </section>
      <section className="report-panel"><PanelHeading index="02" title="Sudden Level Changes" subtitle="Prioritizing a calm, non-startling listening experience" />
        <div className="event-row"><b>Demo</b>{analysis.demo.motion.suddenEvents.length ? analysis.demo.motion.suddenEvents.slice(0, 6).map((event) => <span key={event.time}>{formatTimestamp(event.time)} <small>+{event.jumpDb.toFixed(1)} dB</small></span>) : <em>No notable events detected</em>}</div>
        <div className="event-row"><b>Reference</b>{analysis.reference.motion.suddenEvents.length ? analysis.reference.motion.suddenEvents.slice(0, 6).map((event) => <span key={event.time}>{formatTimestamp(event.time)} <small>+{event.jumpDb.toFixed(1)} dB</small></span>) : <em>No notable events detected</em>}</div>
      </section>
      <section className="report-panel"><PanelHeading index="03" title="Loudness & Dynamics Findings" subtitle="Measurement first, interpretation second" /><RelevantFindings analysis={analysis} sections={["Loudness & Dynamics"]} /></section>
    </div>
  );
}

function PriorityTab({ analysis }: { analysis: PairAnalysis }) {
  const high = analysis.findings.filter((finding) => finding.impact === "High");
  const medium = analysis.findings.filter((finding) => finding.impact === "Medium");
  const improvements = analysis.findings.filter((finding) => finding.impact === "Low" && finding.source === "Measurement");
  const creative = analysis.findings.filter((finding) => finding.impact === "Low" && finding.source === "Inference");

  return (
    <div className="report-stack">
      <section className="report-panel priority-intro">
        <PanelHeading index="01" title="Priority Ranking" subtitle="Resolve release-critical issues first, then refine the mix" />
        <p>Findings are ranked by measured impact, then by analysis section. Use the timestamp and A/B player to confirm each issue before changing the session.</p>
      </section>
      <div className="priority-groups">
        <PriorityGroup label="Fix First" description="Address before release" tone="high" findings={high} />
        <PriorityGroup label="Important Next" description="Review in the next mix pass" tone="medium" findings={medium} />
        <PriorityGroup label="Additional Improvements" description="Optional measured refinements" tone="low" findings={improvements} />
        <PriorityGroup label="Creative Preferences" description="Listening-led inferred refinements" tone="low" findings={creative} />
      </div>
    </div>
  );
}

function PriorityGroup({ label, description, tone, findings }: { label: string; description: string; tone: "high" | "medium" | "low"; findings: Finding[] }) {
  return (
    <section className={`report-panel priority-group ${tone}`}>
      <header><div><span /> <b>{label}</b></div><small>{description}</small><strong>{findings.length}</strong></header>
      {findings.length
        ? <div className="finding-list">{findings.map((finding, index) => <FindingCard key={finding.id} finding={finding} rank={index + 1} />)}</div>
        : <div className="empty-findings"><span>✓</span>{tone === "high" ? "No critical issues detected" : "No findings at this priority level."}</div>}
    </section>
  );
}

function FeedbackTab({ analysis, copied, onCopy }: { analysis: PairAnalysis; copied: boolean; onCopy: () => void }) {
  return (
    <div className="feedback-layout">
      <section className="report-panel feedback-document">
        <div className="feedback-head"><PanelHeading index="VN" title="Producer Feedback" subtitle="Output language: Vietnamese · prioritized and timestamped" /><GlassButton className="feedback-copy-button" size="default" variant="secondary" type="button" onClick={onCopy}>{copied ? "Copied ✓" : "Copy Feedback"}</GlassButton></div>
        <div className="feedback-section"><h3>Điểm đã làm tốt</h3>{analysis.feedback.good.map((item) => <p key={item}>{item}</p>)}</div>
        <div className="feedback-section"><h3>Các chỉnh sửa ưu tiên</h3>{analysis.feedback.priority.length ? analysis.feedback.priority.map((item) => <p key={item}>{item}</p>) : <p>Hiện chưa có lỗi kỹ thuật lớn; vui lòng kiểm tra lại bằng tai nghe trước khi master cuối.</p>}</div>
        <div className="feedback-section"><h3>Đề xuất bổ sung</h3>{analysis.feedback.supplemental.length ? analysis.feedback.supplemental.map((item) => <p key={item}>{item}</p>) : <p>Giữ nguyên các phần đang cân bằng và tránh xử lý toàn master nếu vấn đề chỉ nằm ở một layer.</p>}</div>
        <div className="feedback-section goal"><h3>Mục tiêu của bản chỉnh sửa tiếp theo</h3><p>{analysis.feedback.goal}</p></div>
      </section>
      <aside className="feedback-aside">
        <section className="report-panel"><span className="aside-label">BEFORE SENDING</span><ul><li>Review each timestamp with the A/B player.</li><li>Hz and dB values are starting points, not prescriptions.</li><li>An inference is not a confirmed fault.</li><li>Adjust the source track or bus before the master.</li></ul></section>
        <section className="report-panel"><span className="aside-label">PRESERVE</span><ul>{analysis.keepElements.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </aside>
    </div>
  );
}

function SpectrumChart({ analysis }: { analysis: PairAnalysis }) {
  const tracks = [
    {
      key: "demo",
      label: "Demo",
      color: "#40dece",
      gradient: "spectrum-demo-fill",
      values: analysis.demo.spectral.curve.map((point) => ({
        frequency: point.frequency,
        db: (point.leftDb + point.rightDb) * 0.5 + analysis.loudnessMatch.demoGainDb,
      })),
    },
    {
      key: "reference",
      label: "Reference",
      color: "#a38dff",
      gradient: "spectrum-reference-fill",
      values: analysis.reference.spectral.curve.map((point) => ({
        frequency: point.frequency,
        db: (point.leftDb + point.rightDb) * 0.5 + analysis.loudnessMatch.referenceGainDb,
      })),
    },
  ];
  const all = tracks.flatMap((track) => track.values.map((point) => point.db));
  const maxDb = Math.ceil(Math.max(...all) / 5) * 5 + 2;
  const minDb = maxDb - 62;
  const plot = { left: 14, right: 874, top: 16, bottom: 306 };
  const x = (frequency: number) => plot.left + Math.log10(frequency / 20) / Math.log10(20000 / 20) * (plot.right - plot.left);
  const y = (db: number) => plot.top + (maxDb - clampNumber(db, minDb, maxDb)) / (maxDb - minDb) * (plot.bottom - plot.top);
  const majorFrequencies = [20, 30, 40, 60, 80, 100, 200, 300, 400, 600, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 20000];
  const minorFrequencies = [50, 70, 90, 150, 250, 500, 700, 1500, 2500, 5000, 7000, 15000];
  const horizontalTicks = Array.from({ length: 11 }, (_, index) => maxDb - index * (maxDb - minDb) / 10);
  const frequencyLabel = (frequency: number) => frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
  const linePath = (values: typeof tracks[number]["values"]) => values.map((point, index) => `${index ? "L" : "M"}${x(point.frequency).toFixed(1)},${y(point.db).toFixed(1)}`).join(" ");
  const areaPath = (values: typeof tracks[number]["values"]) => {
    if (!values.length) return "";
    const spectrumPoints = values.map((point) => `${x(point.frequency).toFixed(1)},${y(point.db).toFixed(1)}`).join(" L");
    return `M${x(values[0].frequency).toFixed(1)},${plot.bottom} L${spectrumPoints} L${x(values[values.length - 1].frequency).toFixed(1)},${plot.bottom} Z`;
  };

  return (
    <div className="spectrum-wrap">
      <div className="spectrum-toolbar">
        <div className="chart-legend">{tracks.map((track) => <span key={track.key}><i style={{ "--legend-color": track.color } as React.CSSProperties} />{track.label}</span>)}</div>
      </div>
      <div className="spectrum-frame">
      <svg className="spectrum-chart" viewBox="0 0 920 340" role="img" aria-label="Demo and Reference left/right spectrum comparison">
        <title>Average spectrum after loudness matching</title>
        <desc>The Demo average spectrum is shown in cyan and the Reference average spectrum is shown in violet.</desc>
        <defs>
          <linearGradient id="spectrum-demo-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#43e2d1" stopOpacity=".58" /><stop offset="1" stopColor="#1f8f89" stopOpacity=".16" /></linearGradient>
          <linearGradient id="spectrum-reference-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#aa94ff" stopOpacity=".52" /><stop offset="1" stopColor="#6150a8" stopOpacity=".13" /></linearGradient>
          <clipPath id="spectrum-plot-clip"><rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} rx="4" /></clipPath>
        </defs>
        <rect className="spectrum-background" x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} rx="5" />
        {horizontalTicks.map((tick, index) => <g key={tick}><line className={index % 2 ? "horizontal minor" : "horizontal"} x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} /><text className="db-label" x="900" y={y(tick) + 3} textAnchor="end">{Math.round(tick)}</text></g>)}
        {minorFrequencies.map((frequency) => <line key={frequency} className="vertical minor" x1={x(frequency)} x2={x(frequency)} y1={plot.top} y2={plot.bottom} />)}
        {majorFrequencies.map((frequency) => <g key={frequency}><line className="vertical" x1={x(frequency)} x2={x(frequency)} y1={plot.top} y2={plot.bottom} /><text className="frequency-label" x={x(frequency)} y="326" textAnchor="middle">{frequencyLabel(frequency)}</text></g>)}
        <text className="axis-unit" x="904" y="16" textAnchor="end">dBFS</text>
        <text className="axis-unit" x={plot.right} y="338" textAnchor="end">Hz</text>
        <g clipPath="url(#spectrum-plot-clip)">
          {[...tracks].reverse().map((track) => <path key={`${track.key}-area`} className={`spectrum-area ${track.key}`} d={areaPath(track.values)} fill={`url(#${track.gradient})`} />)}
          {tracks.map((track) => <path key={`${track.key}-mean`} className={`spectrum-mean ${track.key}`} d={linePath(track.values)} stroke={track.color} />)}
        </g>
      </svg>
      </div>
      {analysis.demo.meta.codecWarning || analysis.reference.meta.codecWarning ? <div className="codec-banner"><b>Codec limit:</b> high-frequency conclusions are limited to approximately {(Math.min(analysis.demo.meta.comparableHighHz, analysis.reference.meta.comparableHighHz) / 1000).toFixed(0)} kHz.</div> : null}
    </div>
  );
}

function BandDeltaChart({ analysis }: { analysis: PairAnalysis }) {
  return <div className="band-delta-list">{analysis.bands.map((band) => {
    const size = Math.min(49, Math.abs(band.deltaDb) / 6 * 49);
    return <div className="band-delta" key={band.key}><div><b>{band.label}</b><small>{band.range}</small></div><div className="delta-track"><i /><span className={band.deltaDb >= 0 ? "positive" : "negative"} style={{ width: `${size}%` }} /></div><strong className={Math.abs(band.deltaDb) >= 3 ? "large" : ""}>{signed(band.deltaDb, " dB")}</strong><small>L {signed(band.leftDeltaDb)} / R {signed(band.rightDeltaDb)}</small></div>;
  })}</div>;
}

function RelevantFindings({ analysis, sections }: { analysis: PairAnalysis; sections: Finding["section"][] }) {
  const findings = analysis.findings.filter((finding) => sections.includes(finding.section));
  if (!findings.length) return <div className="empty-findings"><span>✓</span>No material differences were detected in this category.</div>;
  return <div className="finding-list">{findings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div>;
}

function FindingCard({ finding, rank }: { finding: Finding; rank?: number }) {
  const impactClass = finding.impact === "High" ? "high" : finding.impact === "Medium" ? "medium" : "low";
  return (
    <article className={`finding-card ${impactClass}`}>
      <div className="finding-rank">{rank ? String(rank).padStart(2, "0") : <span />}</div>
      <div className="finding-main">
        <div className="finding-title"><h3>{finding.title}</h3><span className={`impact-badge ${impactClass}`}>{finding.impact} impact</span></div>
        <div className="finding-meta"><span className="timestamp">Detected At: {finding.timestamp}</span><span>Affected Element: {finding.section}</span><span>Source: {finding.source}</span><span>Confidence: {finding.confidence}</span></div>
        <div className="finding-evidence"><b>Demo vs Reference Difference</b><p>{finding.evidence}</p></div>
        <div className="recommendation"><b>Recommended Adjustment</b>{finding.recommendation}</div>
      </div>
    </article>
  );
}

function PanelHeading({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="panel-heading"><span>{index}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function Metric({ label, value, note, tone, compact }: { label: string; value: string; note: string; tone?: "good" | "bad"; compact?: boolean }) {
  return <div className={`metric ${tone ?? ""} ${compact ? "compact" : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function clampNumber(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
