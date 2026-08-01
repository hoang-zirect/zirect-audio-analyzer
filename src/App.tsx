import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzePair,
  BAND_DEFINITIONS,
  Finding,
  formatTimestamp,
  PairAnalysis,
} from "./audio-analysis";

type Slot = "demo" | "reference";
type View = "new" | "report";
type ReportTab = "overview" | "stereo" | "eq" | "dynamics" | "feedback";

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
  if (!seconds || !Number.isFinite(seconds)) return "Đang chờ giải mã";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60).toString().padStart(2, "0");
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
  if (!copied) throw new Error("Trình duyệt không cho phép sao chép tự động.");
}

export default function Home() {
  const [demo, setDemo] = useState<SelectedAudio | null>(null);
  const [reference, setReference] = useState<SelectedAudio | null>(null);
  const [dragging, setDragging] = useState<Slot | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Slot, string>>>({});
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [view, setView] = useState<View>("new");
  const [analysis, setAnalysis] = useState<PairAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ value: 0, label: "Đang chuẩn bị" });
  const demoInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  const validateFile = (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      return "Định dạng chưa được hỗ trợ. Hãy dùng WAV, FLAC, MP3, M4A, AAC, OGG hoặc OPUS.";
    }
    if (file.size > MAX_FILE_SIZE) return "File vượt quá giới hạn 500 MB.";
    return null;
  };

  const setSlotFile = (slot: Slot, file: File) => {
    const error = validateFile(file);
    setErrors((current) => ({ ...current, [slot]: error ?? undefined }));
    if (error) return;
    const next = { file };
    if (slot === "demo") setDemo(next);
    else setReference(next);
    setAnalysis(null);
    setAnalysisError(null);
  };

  const onInput = (slot: Slot, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setSlotFile(slot, file);
    event.target.value = "";
  };

  const onDrop = (slot: Slot, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(null);
    const file = event.dataTransfer.files?.[0];
    if (file) setSlotFile(slot, file);
  };

  const removeFile = (slot: Slot) => {
    if (slot === "demo") setDemo(null);
    else setReference(null);
    setErrors((current) => ({ ...current, [slot]: undefined }));
    setAnalysis(null);
    setAnalysisError(null);
  };

  const runAnalysis = async () => {
    if (!demo || !reference || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setProgress({ value: 1, label: "Đang chuẩn bị engine đo lường" });
    try {
      const result = await analyzePair(demo.file, reference.file, (value, label) => {
        setProgress({ value, label });
      });
      setAnalysis(result);
      setDemo((current) => current ? ({ ...current, duration: result.demo.meta.duration, sampleRate: result.demo.meta.analysisSampleRate, channels: result.demo.meta.channels }) : current);
      setReference((current) => current ? ({ ...current, duration: result.reference.meta.duration, sampleRate: result.reference.meta.analysisSampleRate, channels: result.reference.meta.channels }) : current);
      setView("report");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể phân tích file.";
      setAnalysisError(`Không thể giải mã hoặc đo một trong hai file: ${message}. Hãy thử WAV/FLAC sạch và chạy lại.`);
    } finally {
      setAnalyzing(false);
    }
  };

  const fileReady = Boolean(demo && reference);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Điều hướng chính">
        <div className="brand" aria-label="Zirect Lab">
          <span className="brand-mark"><i /><b>ZL</b></span>
          <span>Zirect Lab</span>
        </div>
        <nav className="side-nav">
          <button className={`nav-item ${view === "new" ? "active" : ""}`} type="button" onClick={() => setView("new")}>
            <span className="nav-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            Phân tích mới
          </button>
          <button className={`nav-item ${view === "report" ? "active" : ""}`} type="button" disabled={!analysis} onClick={() => analysis && setView("report")}>
            <span className="nav-doc" aria-hidden="true" />
            Báo cáo
          </button>
        </nav>
        <div className="system-ready"><span className="status-led" />Hệ thống sẵn sàng</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <span>AUDIO ANALYZER / {view === "report" ? "BÁO CÁO" : "SESSION MỚI"}</span>
          <span className="privacy">Xử lý trên thiết bị <i /> Không lưu file <b /></span>
        </header>

        {view === "new" ? (
          <UploadWorkspace
            demo={demo}
            reference={reference}
            errors={errors}
            analysisError={analysisError}
            dragging={dragging}
            fileReady={fileReady}
            hasReport={Boolean(analysis)}
            demoInput={demoInput}
            referenceInput={referenceInput}
            onInput={onInput}
            onDrop={onDrop}
            onDrag={setDragging}
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

type UploadWorkspaceProps = {
  demo: SelectedAudio | null;
  reference: SelectedAudio | null;
  errors: Partial<Record<Slot, string>>;
  analysisError: string | null;
  dragging: Slot | null;
  fileReady: boolean;
  hasReport: boolean;
  demoInput: React.RefObject<HTMLInputElement | null>;
  referenceInput: React.RefObject<HTMLInputElement | null>;
  onInput: (slot: Slot, event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (slot: Slot, event: DragEvent<HTMLDivElement>) => void;
  onDrag: (slot: Slot | null) => void;
  onRemove: (slot: Slot) => void;
  onAnalyze: () => void;
  onOpenReport: () => void;
};

function UploadWorkspace(props: UploadWorkspaceProps) {
  return (
    <>
      <div className="content upload-content">
        <section className="hero-row">
          <div>
            <p className="eyebrow">DEEP SLEEP QUALITY CONTROL</p>
            <h1>So sánh Demo với Reference</h1>
            <p className="subtitle">Đo trực tiếp <i /> Loudness-matched <i /> Per-channel</p>
          </div>
          <div className={`file-status ${props.fileReady ? "has-files" : ""}`}><span className="status-led" />{props.fileReady ? "ĐỦ 2 FILE" : "CHƯA CÓ FILE"}</div>
        </section>

        <section className="upload-grid" aria-label="Tải hai file audio">
          <UploadCard slot="demo" title="BẢN DEMO" hint="Bản cần kiểm tra" audio={props.demo} error={props.errors.demo} active={props.dragging === "demo"} inputRef={props.demoInput} onInput={props.onInput} onDrop={props.onDrop} onDrag={props.onDrag} onRemove={props.onRemove} />
          <UploadCard slot="reference" title="BẢN REFERENCE" hint="Mẫu chất lượng mục tiêu" audio={props.reference} error={props.errors.reference} active={props.dragging === "reference"} inputRef={props.referenceInput} onInput={props.onInput} onDrop={props.onDrop} onDrag={props.onDrag} onRemove={props.onRemove} />
        </section>

        <section className="scope-panel">
          <div className="scope-title">PHẠM VI PHÂN TÍCH</div>
          <div className="scope-grid">
            <ScopeItem icon="lufs" label="LUFS" />
            <ScopeItem icon="stereo" label="Stereo" />
            <ScopeItem icon="phase" label="Phase" />
            <ScopeItem icon="eq" label="EQ" />
            <ScopeItem icon="dynamics" label="Dynamics" />
          </div>
        </section>

        {props.analysisError ? <div className="analysis-error" role="alert"><b>Không thể hoàn tất phân tích</b><span>{props.analysisError}</span></div> : null}
        {props.hasReport ? <button className="resume-report" type="button" onClick={props.onOpenReport}>Mở lại báo cáo gần nhất <span>→</span></button> : null}
      </div>

      <footer className="actionbar">
        <div className="trial-note"><span>i</span>Kết quả Hz và dB là điểm bắt đầu để thử</div>
        <div className="action-state">{props.fileReady ? "Sẵn sàng đo trực tiếp hai file" : "Cần đủ 2 file để tiếp tục"}</div>
        <button className="analyze-button" type="button" onClick={props.onAnalyze} disabled={!props.fileReady}>Bắt đầu phân tích<span aria-hidden="true">→</span></button>
      </footer>
    </>
  );
}

type UploadCardProps = {
  slot: Slot;
  title: string;
  hint: string;
  audio: SelectedAudio | null;
  error?: string;
  active: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInput: (slot: Slot, event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (slot: Slot, event: DragEvent<HTMLDivElement>) => void;
  onDrag: (slot: Slot | null) => void;
  onRemove: (slot: Slot) => void;
};

function UploadCard({ slot, title, hint, audio, error, active, inputRef, onInput, onDrop, onDrag, onRemove }: UploadCardProps) {
  return (
    <article className={`upload-card ${active ? "dragging" : ""} ${audio ? "selected" : ""}`}>
      <span className="corner top-left" /><span className="corner top-right" /><span className="corner bottom-left" /><span className="corner bottom-right" />
      <h2>{title}</h2>
      <div className="drop-zone" onDragEnter={(event) => { event.preventDefault(); onDrag(slot); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onDrag(null); }} onDrop={(event) => onDrop(slot, event)}>
        <input ref={inputRef} type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg,.opus" onChange={(event) => onInput(slot, event)} aria-label={`Chọn ${title.toLowerCase()}`} />
        {audio ? (
          <div className="selected-file">
            <div className="file-chip-icon"><span /><span /><span /></div>
            <div className="file-copy"><strong title={audio.file.name}>{audio.file.name}</strong><span>{formatBytes(audio.file.size)} · {formatDuration(audio.duration)}{audio.sampleRate ? ` · ${audio.sampleRate / 1000} kHz · ${audio.channels === 1 ? "Mono" : "Stereo"}` : ""}</span></div>
            <button type="button" onClick={() => onRemove(slot)} aria-label={`Xóa ${audio.file.name}`}>×</button>
          </div>
        ) : (
          <>
            <div className="audio-file-icon" aria-hidden="true"><i /><span><b /><b /><b /><b /></span></div>
            <p>Kéo thả file âm thanh vào đây</p>
            <button type="button" className="choose-file" onClick={() => inputRef.current?.click()}>hoặc chọn từ máy</button>
            <small>WAV / FLAC / MP3 · Tối đa 500 MB</small>
          </>
        )}
        {error ? <div className="file-error" role="alert">{error}</div> : null}
        <div className="drop-hint">{hint}</div>
      </div>
    </article>
  );
}

function ScopeItem({ icon, label }: { icon: string; label: string }) {
  return <div className="scope-item"><span className={`scope-icon ${icon}`} aria-hidden="true"><i /><i /><i /><i /><i /></span><span>{label}</span></div>;
}

function AnalysisProgress({ progress, label }: { progress: number; label: string }) {
  const stages = [
    { at: 3, label: "Kiểm tra file" },
    { at: 10, label: "LUFS & loudness" },
    { at: 35, label: "Stereo & phase" },
    { at: 60, label: "Phổ L/R" },
    { at: 88, label: "Dynamics & timeline" },
    { at: 99, label: "Viết báo cáo" },
  ];
  return (
    <div className="analysis-overlay" role="dialog" aria-modal="true" aria-label="Đang phân tích audio">
      <div className="analysis-modal">
        <div className="scanner-mark"><span /><span /><span /><span /><span /></div>
        <p className="eyebrow">DSP ANALYSIS RUNNING</p>
        <h2>Đang đo trực tiếp hai file</h2>
        <p className="progress-label">{label}</p>
        <div className="progress-track"><i style={{ width: `${Math.max(2, progress)}%` }} /></div>
        <div className="progress-value">{Math.round(progress)}%</div>
        <div className="progress-stages">
          {stages.map((stage) => <div key={stage.label} className={progress >= stage.at ? "done" : ""}><span />{stage.label}</div>)}
        </div>
        <small>File được xử lý trong trình duyệt và không được tải lên kho lưu trữ.</small>
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
    { key: "overview", label: "Tổng quan" },
    { key: "stereo", label: "Stereo & Phase" },
    { key: "eq", label: "EQ & Phổ tần" },
    { key: "dynamics", label: "Dynamics" },
    { key: "feedback", label: "Feedback producer" },
  ];

  return (
    <>
      <div className="content report-content">
        <section className="report-hero">
          <div>
            <p className="eyebrow">ANALYSIS COMPLETE / LOUDNESS-MATCHED</p>
            <h1>Báo cáo Demo vs Reference</h1>
            <p className="report-subtitle">{analysis.demo.meta.name} <i /> {analysis.reference.meta.name}</p>
          </div>
          <div className={`verdict ${analysis.releaseVerdict.startsWith("Chưa") ? "danger" : analysis.releaseVerdict.startsWith("Nên") ? "warning" : "pass"}`}>
            <ScoreRing score={analysis.qualityScore} />
            <div><span>ĐÁNH GIÁ PHÁT HÀNH</span><strong>{analysis.releaseVerdict}</strong></div>
          </div>
        </section>

        <LoudnessMatch analysis={analysis} />
        <ABPlayer analysis={analysis} demoFile={demoFile} referenceFile={referenceFile} />

        <nav className="report-tabs" aria-label="Các phần báo cáo">
          {tabs.map((item) => <button key={item.key} type="button" className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>{item.label}</button>)}
        </nav>

        <div className="report-body">
          {tab === "overview" ? <OverviewTab analysis={analysis} /> : null}
          {tab === "stereo" ? <StereoTab analysis={analysis} /> : null}
          {tab === "eq" ? <EqTab analysis={analysis} /> : null}
          {tab === "dynamics" ? <DynamicsTab analysis={analysis} /> : null}
          {tab === "feedback" ? <FeedbackTab analysis={analysis} copied={copied} onCopy={copyFeedback} /> : null}
        </div>
      </div>

      <footer className="actionbar report-actionbar">
        <div className="trial-note"><span>i</span>Đo lường và suy luận được ghi nhãn riêng</div>
        <button type="button" className="secondary-action" onClick={onNew}>Thay file / phân tích mới</button>
        <button type="button" className="analyze-button" onClick={tab === "feedback" ? copyFeedback : () => setTab("feedback")}>
          {tab === "feedback" ? (copied ? "Đã sao chép feedback" : "Sao chép feedback") : "Mở feedback producer"}<span>→</span>
        </button>
      </footer>
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
      <div className="match-title"><span className="status-led" /><div><b>LOUDNESS-MATCH ĐÃ ÁP DỤNG TRƯỚC KHI SO SÁNH</b><small>Hai bản được hạ về cùng {match.targetLufs.toFixed(1)} LUFS-I để đối chiếu phổ và không gian</small></div></div>
      <div className="match-metrics">
        <Metric compact label="Demo gốc" value={`${analysis.demo.loudness.integratedLufs.toFixed(1)} LUFS`} note={`Gain ${signed(match.demoGainDb, " dB")}`} />
        <span className="match-arrow">⇄</span>
        <Metric compact label="Reference gốc" value={`${analysis.reference.loudness.integratedLufs.toFixed(1)} LUFS`} note={`Gain ${signed(match.referenceGainDb, " dB")}`} />
        <Metric compact label="Chênh lệch ban đầu" value={`${Math.abs(match.originalDeltaDb).toFixed(1)} dB`} note={match.originalDeltaDb > 0 ? "Demo lớn hơn" : match.originalDeltaDb < 0 ? "Reference lớn hơn" : "Bằng nhau"} />
      </div>
    </section>
  );
}

function ABPlayer({ analysis, demoFile, referenceFile }: { analysis: PairAnalysis; demoFile: File; referenceFile: File }) {
  const demoAudio = useRef<HTMLAudioElement>(null);
  const referenceAudio = useRef<HTMLAudioElement>(null);
  const urls = useMemo(() => ({ demo: URL.createObjectURL(demoFile), reference: URL.createObjectURL(referenceFile) }), [demoFile, referenceFile]);
  const [active, setActive] = useState<Slot | null>(null);
  const [position, setPosition] = useState(0);
  const duration = Math.min(analysis.demo.meta.duration, analysis.reference.meta.duration);

  useEffect(() => {
    return () => { URL.revokeObjectURL(urls.demo); URL.revokeObjectURL(urls.reference); };
  }, [urls]);

  useEffect(() => {
    if (demoAudio.current) demoAudio.current.volume = Math.min(1, 10 ** (analysis.loudnessMatch.demoGainDb / 20));
    if (referenceAudio.current) referenceAudio.current.volume = Math.min(1, 10 ** (analysis.loudnessMatch.referenceGainDb / 20));
  }, [analysis]);

  const toggle = async (slot: Slot) => {
    const target = slot === "demo" ? demoAudio.current : referenceAudio.current;
    const other = slot === "demo" ? referenceAudio.current : demoAudio.current;
    if (!target) return;
    other?.pause();
    if (active === slot && !target.paused) { target.pause(); setActive(null); return; }
    target.currentTime = Math.min(position, Math.max(0, target.duration - 0.1));
    await target.play();
    setActive(slot);
  };

  const seek = (value: number) => {
    setPosition(value);
    if (demoAudio.current) demoAudio.current.currentTime = Math.min(value, demoAudio.current.duration || value);
    if (referenceAudio.current) referenceAudio.current.currentTime = Math.min(value, referenceAudio.current.duration || value);
  };

  return (
    <section className="ab-player">
      <div className="ab-label"><span>A/B PLAYER</span><small>Playback đã bù gain theo loudness-match</small></div>
      <button type="button" className={active === "demo" ? "active" : ""} onClick={() => toggle("demo")}><i />{active === "demo" ? "Dừng Demo" : "Nghe Demo"}<small>{signed(analysis.loudnessMatch.demoGainDb, " dB")}</small></button>
      <button type="button" className={active === "reference" ? "active" : ""} onClick={() => toggle("reference")}><i />{active === "reference" ? "Dừng Reference" : "Nghe Reference"}<small>{signed(analysis.loudnessMatch.referenceGainDb, " dB")}</small></button>
      <div className="ab-timeline"><input aria-label="Vị trí phát A/B" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} onChange={(event) => seek(Number(event.target.value))} /><span>{formatTimestamp(position)} / {formatTimestamp(duration)}</span></div>
      <audio ref={demoAudio} src={urls.demo} onTimeUpdate={(event) => active === "demo" && setPosition(event.currentTarget.currentTime)} onEnded={() => setActive(null)} />
      <audio ref={referenceAudio} src={urls.reference} onTimeUpdate={(event) => active === "reference" && setPosition(event.currentTarget.currentTime)} onEnded={() => setActive(null)} />
    </section>
  );
}

function OverviewTab({ analysis }: { analysis: PairAnalysis }) {
  return (
    <div className="report-stack">
      <section className="summary-grid">
        <article className="report-panel strengths-panel"><PanelHeading index="01" title="Điểm mạnh của Demo" subtitle="Các phần nên giữ nguyên" />
          <ul className="strength-list">{analysis.strengths.map((item) => <li key={item}><span>✓</span>{item}</li>)}</ul>
        </article>
        <article className="report-panel differences-panel"><PanelHeading index="02" title="Ba khác biệt lớn nhất" subtitle="Theo thứ tự ưu tiên" />
          <ol className="difference-list">{analysis.threeBiggestDifferences.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol>
        </article>
      </section>

      <section className="report-panel"><PanelHeading index="03" title="Xếp hạng vấn đề" subtitle={`${analysis.findings.length} kết luận có bằng chứng`} />
        <div className="finding-list">{analysis.findings.slice(0, 7).map((finding, index) => <FindingCard key={finding.id} finding={finding} rank={index + 1} />)}</div>
      </section>

      {analysis.referenceWarnings.length ? <section className="report-panel reference-warning"><PanelHeading index="REF" title="Điểm không nên bắt chước ở Reference" subtitle="Giữ phần kỹ thuật tốt hơn của Demo" />
        <div className="finding-list">{analysis.referenceWarnings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div>
      </section> : null}
    </div>
  );
}

function StereoTab({ analysis }: { analysis: PairAnalysis }) {
  const rows = [
    { label: "Tổng thể", range: "Full range", demo: analysis.demo.stereo, reference: analysis.reference.stereo },
    ...BAND_DEFINITIONS.map((definition) => ({ label: definition.label, range: definition.range, demo: analysis.demo.spectral.bands[definition.key], reference: analysis.reference.spectral.bands[definition.key] })),
  ];
  return (
    <div className="report-stack">
      <section className="metric-grid four">
        <Metric label="Demo width" value={`${analysis.demo.stereo.widthPercent.toFixed(0)}%`} note={`Reference ${analysis.reference.stereo.widthPercent.toFixed(0)}%`} />
        <Metric label="Correlation" value={analysis.demo.stereo.correlation.toFixed(2)} note={`Reference ${analysis.reference.stereo.correlation.toFixed(2)}`} tone={analysis.demo.stereo.correlation < 0.1 ? "bad" : "good"} />
        <Metric label="Mono retention" value={`${analysis.demo.stereo.monoRetentionDb.toFixed(1)} dB`} note={`Reference ${analysis.reference.stereo.monoRetentionDb.toFixed(1)} dB`} tone={analysis.demo.stereo.monoRetentionDb < -4 ? "bad" : "good"} />
        <Metric label="L/R balance" value={`${signed(analysis.demo.stereo.balanceDb, " dB")}`} note={analysis.demo.stereo.balanceDb > 0 ? "Nghiêng trái" : analysis.demo.stereo.balanceDb < 0 ? "Nghiêng phải" : "Cân bằng"} />
      </section>
      <section className="report-panel"><PanelHeading index="01" title="Stereo theo dải" subtitle="Đo riêng từng vùng tần số sau giải mã" />
        <div className="data-table stereo-table"><div className="table-row table-head"><span>Dải</span><span>Demo width</span><span>Ref width</span><span>Demo corr.</span><span>Ref corr.</span></div>
          {rows.map((row) => <div className="table-row" key={row.label}><span><b>{row.label}</b><small>{row.range}</small></span><span>{row.demo.widthPercent.toFixed(0)}%</span><span>{row.reference.widthPercent.toFixed(0)}%</span><span className={row.demo.correlation < 0 ? "negative" : ""}>{row.demo.correlation.toFixed(2)}</span><span className={row.reference.correlation < 0 ? "negative" : ""}>{row.reference.correlation.toFixed(2)}</span></div>)}
        </div>
      </section>
      <section className="report-panel"><PanelHeading index="02" title="Kết luận Stereo & không gian" subtitle="Phân tích đầu tiên theo yêu cầu" /><RelevantFindings analysis={analysis} sections={["Stereo & không gian"]} /></section>
    </div>
  );
}

function EqTab({ analysis }: { analysis: PairAnalysis }) {
  return (
    <div className="report-stack">
      <section className="report-panel spectrum-panel"><PanelHeading index="01" title="Phổ trung bình per-channel" subtitle="L/R riêng biệt, đã loudness-match" /><SpectrumChart analysis={analysis} /></section>
      <section className="report-panel"><PanelHeading index="02" title="Chênh lệch theo dải" subtitle="Giá trị dương: Demo nhiều hơn Reference" /><BandDeltaChart analysis={analysis} /></section>
      <section className="report-panel"><PanelHeading index="03" title="Kết luận EQ" subtitle="Track/bus/master và khoảng dB để thử" /><RelevantFindings analysis={analysis} sections={["EQ & cân bằng phổ", "Chất lượng file"]} /></section>
    </div>
  );
}

function DynamicsTab({ analysis }: { analysis: PairAnalysis }) {
  const metrics = [
    ["Integrated loudness", `${analysis.demo.loudness.integratedLufs.toFixed(1)} LUFS`, `${analysis.reference.loudness.integratedLufs.toFixed(1)} LUFS`],
    ["True peak ước tính 4×", `${analysis.demo.loudness.truePeakDbtp.toFixed(1)} dBTP`, `${analysis.reference.loudness.truePeakDbtp.toFixed(1)} dBTP`],
    ["Loudness range", `${analysis.demo.loudness.lraLu.toFixed(1)} LU`, `${analysis.reference.loudness.lraLu.toFixed(1)} LU`],
    ["Crest factor", `${analysis.demo.loudness.crestFactorDb.toFixed(1)} dB`, `${analysis.reference.loudness.crestFactorDb.toFixed(1)} dB`],
    ["RMS", `${analysis.demo.loudness.rmsDbfs.toFixed(1)} dBFS`, `${analysis.reference.loudness.rmsDbfs.toFixed(1)} dBFS`],
    ["Onset proxy", `${analysis.demo.motion.onsetProxyPerMinute.toFixed(1)}/phút`, `${analysis.reference.motion.onsetProxyPerMinute.toFixed(1)}/phút`],
    ["Outro 100 ms cuối", `${analysis.demo.motion.outroEndDb.toFixed(1)} dBFS`, `${analysis.reference.motion.outroEndDb.toFixed(1)} dBFS`],
  ];
  return (
    <div className="report-stack">
      <section className="report-panel"><PanelHeading index="01" title="Loudness & dynamic range" subtitle="Độ to không được dùng thay cho chất lượng" />
        <div className="data-table dynamics-table"><div className="table-row table-head"><span>Chỉ số</span><span>Demo</span><span>Reference</span></div>{metrics.map(([label, demo, reference]) => <div className="table-row" key={label}><span>{label}</span><span>{demo}</span><span>{reference}</span></div>)}</div>
      </section>
      <section className="report-panel"><PanelHeading index="02" title="Các đoạn thay đổi đột ngột" subtitle="Ưu tiên trải nghiệm không gây giật mình" />
        <div className="event-row"><b>Demo</b>{analysis.demo.motion.suddenEvents.length ? analysis.demo.motion.suddenEvents.slice(0, 6).map((event) => <span key={event.time}>{formatTimestamp(event.time)} <small>+{event.jumpDb.toFixed(1)} dB</small></span>) : <em>Không phát hiện sự kiện nổi bật</em>}</div>
        <div className="event-row"><b>Reference</b>{analysis.reference.motion.suddenEvents.length ? analysis.reference.motion.suddenEvents.slice(0, 6).map((event) => <span key={event.time}>{formatTimestamp(event.time)} <small>+{event.jumpDb.toFixed(1)} dB</small></span>) : <em>Không phát hiện sự kiện nổi bật</em>}</div>
      </section>
      <section className="report-panel"><PanelHeading index="03" title="Kết luận dynamics, melody và reverb" subtitle="Đo lường trước, suy luận sau" /><RelevantFindings analysis={analysis} sections={["Loudness & dynamics", "Melody & motif", "Arrangement & reverb"]} /></section>
    </div>
  );
}

function FeedbackTab({ analysis, copied, onCopy }: { analysis: PairAnalysis; copied: boolean; onCopy: () => void }) {
  return (
    <div className="feedback-layout">
      <section className="report-panel feedback-document">
        <div className="feedback-head"><PanelHeading index="VN" title="Feedback hoàn chỉnh cho producer" subtitle="Lịch sự, theo mức độ ưu tiên và có timestamp" /><button type="button" onClick={onCopy}>{copied ? "Đã sao chép ✓" : "Sao chép toàn bộ"}</button></div>
        <div className="feedback-section"><h3>Điểm đã làm tốt</h3>{analysis.feedback.good.map((item) => <p key={item}>{item}</p>)}</div>
        <div className="feedback-section"><h3>Các chỉnh sửa ưu tiên</h3>{analysis.feedback.priority.length ? analysis.feedback.priority.map((item) => <p key={item}>{item}</p>) : <p>Hiện chưa có lỗi kỹ thuật lớn; vui lòng kiểm tra lại bằng tai nghe trước khi master cuối.</p>}</div>
        <div className="feedback-section"><h3>Đề xuất bổ sung</h3>{analysis.feedback.supplemental.length ? analysis.feedback.supplemental.map((item) => <p key={item}>{item}</p>) : <p>Giữ nguyên các phần đang cân bằng và tránh xử lý toàn master nếu vấn đề chỉ nằm ở một layer.</p>}</div>
        <div className="feedback-section goal"><h3>Mục tiêu của bản chỉnh sửa tiếp theo</h3><p>{analysis.feedback.goal}</p></div>
      </section>
      <aside className="feedback-aside">
        <section className="report-panel"><span className="aside-label">TRƯỚC KHI GỬI</span><ul><li>Nghe lại các timestamp bằng A/B player.</li><li>Các giá trị Hz và dB chỉ là điểm bắt đầu để thử.</li><li>“Suy luận” không đồng nghĩa với lỗi chắc chắn.</li><li>Ưu tiên chỉnh track hoặc bus trước master.</li></ul></section>
        <section className="report-panel"><span className="aside-label">NÊN GIỮ</span><ul>{analysis.keepElements.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </aside>
    </div>
  );
}

function SpectrumChart({ analysis }: { analysis: PairAnalysis }) {
  const curves = [
    { key: "demoL", label: "Demo L", color: "#29d6c7", dash: "", values: analysis.demo.spectral.curve.map((point) => ({ frequency: point.frequency, db: point.leftDb + analysis.loudnessMatch.demoGainDb })) },
    { key: "demoR", label: "Demo R", color: "#8cf3e9", dash: "4 5", values: analysis.demo.spectral.curve.map((point) => ({ frequency: point.frequency, db: point.rightDb + analysis.loudnessMatch.demoGainDb })) },
    { key: "refL", label: "Ref L", color: "#e7a94b", dash: "", values: analysis.reference.spectral.curve.map((point) => ({ frequency: point.frequency, db: point.leftDb + analysis.loudnessMatch.referenceGainDb })) },
    { key: "refR", label: "Ref R", color: "#f5d59d", dash: "4 5", values: analysis.reference.spectral.curve.map((point) => ({ frequency: point.frequency, db: point.rightDb + analysis.loudnessMatch.referenceGainDb })) },
  ];
  const all = curves.flatMap((curve) => curve.values.map((point) => point.db));
  const maxDb = Math.ceil(Math.max(...all) / 5) * 5 + 2;
  const minDb = maxDb - 62;
  const x = (frequency: number) => 46 + Math.log10(frequency / 20) / Math.log10(20000 / 20) * 824;
  const y = (db: number) => 18 + (maxDb - clampNumber(db, minDb, maxDb)) / (maxDb - minDb) * 238;
  return (
    <div className="spectrum-wrap">
      <div className="chart-legend">{curves.map((curve) => <span key={curve.key}><i style={{ background: curve.color }} />{curve.label}</span>)}</div>
      <svg className="spectrum-chart" viewBox="0 0 900 290" role="img" aria-label="So sánh phổ L/R của Demo và Reference">
        {[0, 1, 2, 3, 4].map((line) => <g key={line}><line x1="46" x2="870" y1={18 + line * 59.5} y2={18 + line * 59.5} /><text x="4" y={22 + line * 59.5}>{Math.round(maxDb - line * (maxDb - minDb) / 4)}</text></g>)}
        {[20, 80, 250, 500, 2000, 4000, 10000, 20000].map((frequency) => <g key={frequency}><line className="vertical" x1={x(frequency)} x2={x(frequency)} y1="18" y2="256" /><text className="frequency-label" x={x(frequency)} y="280" textAnchor="middle">{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</text></g>)}
        {curves.map((curve) => <polyline key={curve.key} points={curve.values.map((point) => `${x(point.frequency)},${y(point.db)}`).join(" ")} fill="none" stroke={curve.color} strokeWidth="1.8" strokeDasharray={curve.dash} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {analysis.demo.meta.codecWarning || analysis.reference.meta.codecWarning ? <div className="codec-banner"><b>Giới hạn codec:</b> chỉ kết luận vùng high tới khoảng {(Math.min(analysis.demo.meta.comparableHighHz, analysis.reference.meta.comparableHighHz) / 1000).toFixed(0)} kHz.</div> : null}
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
  if (!findings.length) return <div className="empty-findings"><span>✓</span>Không phát hiện khác biệt đáng kể trong nhóm này.</div>;
  return <div className="finding-list">{findings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div>;
}

function FindingCard({ finding, rank }: { finding: Finding; rank?: number }) {
  return (
    <article className={`finding-card impact-${finding.impact.toLowerCase().replace("ấ", "a").replace("ư", "u").replace("ơ", "o")}`}>
      <div className="finding-rank">{rank ? String(rank).padStart(2, "0") : <span />}</div>
      <div className="finding-main"><div className="finding-title"><h3>{finding.title}</h3><span className={`impact-badge ${finding.impact === "Cao" ? "high" : finding.impact === "Trung bình" ? "medium" : "low"}`}>{finding.impact}</span></div><div className="finding-meta"><span>{finding.section}</span><span>{finding.timestamp}</span><span>{finding.source}</span><span>Chắc chắn: {finding.confidence}</span></div><p>{finding.evidence}</p><div className="recommendation"><b>Hướng xử lý</b>{finding.recommendation}</div></div>
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
