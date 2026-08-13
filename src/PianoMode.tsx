import { ChangeEvent, useEffect, useRef, useState } from "react";
import { analyzeAudioTonality, melodyContourNotes, parseMidi, PianoReport } from "./piano-analysis";
import { GlassButton } from "./components/GlassButton";

const AUDIO_ACCEPT = ".wav,.flac,.mp3,.m4a,.aac,.ogg,.opus";
const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

function useObjectUrl(file?: File) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url;
}

export function PianoMode() {
  const [demo, setDemo] = useState<File>(); const [reference, setReference] = useState<File>(); const [midi, setMidi] = useState<File>();
  const [report, setReport] = useState<PianoReport>(); const [audioResult, setAudioResult] = useState<{ bpm: number; bpmConfidence: number; key: string; keyConfidence: number; duration: number }>();
  const [bpm, setBpm] = useState(0); const [key, setKey] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [position, setPosition] = useState(0);
  const audio = useRef<HTMLAudioElement>(null); const demoUrl = useObjectUrl(demo); const referenceUrl = useObjectUrl(reference);
  const choose = (setter: (f: File) => void) => (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { setter(f); setReport(undefined); setError(""); } };
  const analyze = async () => { if (!demo || !midi) return; setBusy(true); setError(""); try { const [m, a] = await Promise.all([parseMidi(await midi.arrayBuffer()), analyzeAudioTonality(demo)]); setReport(m); setAudioResult(a); setBpm(a.bpm); setKey(a.key); } catch (e) { setError(e instanceof Error ? e.message : "Không thể phân tích tệp."); } finally { setBusy(false); } };
  if (report && audioResult) return <PianoReportView report={report} audioResult={audioResult} bpm={bpm} keyName={key} setBpm={setBpm} setKey={setKey} demoUrl={demoUrl} referenceUrl={referenceUrl} demoName={demo!.name} audio={audio} position={position} setPosition={setPosition} onNew={() => setReport(undefined)} />;
  return <div className="content piano-upload">
    <section className="piano-hero"><p className="eyebrow">ZIRECT · ĐÁNH GIÁ SÁNG TÁC</p><h1>Piano thư giãn</h1><p>Chỉ đánh giá giai điệu và sáng tác — không đánh giá EQ, stereo, độ lớn, mixing hay mastering. Mọi phép đo đều được xử lý riêng tư ngay trong trình duyệt.</p></section>
    <section className="piano-files">
      <FileTile title="Audio demo" detail="Bắt buộc · dùng để xác định tempo và tông nhạc" accept={AUDIO_ACCEPT} file={demo} onChange={choose(setDemo)} />
      <FileTile title="Audio tham chiếu" detail="Tùy chọn · chỉ dùng làm ngữ cảnh khi nghe" accept={AUDIO_ACCEPT} file={reference} onChange={choose(setReference)} />
      <FileTile title="MIDI sáng tác" detail="Bắt buộc · dùng để đọc nốt, hòa âm, cấu trúc và giai điệu" accept=".mid,.midi,audio/midi" file={midi} onChange={choose(setMidi)} />
    </section>
    <div className="piano-scope"><b>Phạm vi: chỉ sáng tác</b><span>Mô-típ</span><span>Câu nhạc</span><span>Đường nét</span><span>Nhịp điệu</span><span>Hòa âm</span><span>Kết câu</span></div>
    {error && <p className="analysis-error" role="alert">{error}</p>}
    <GlassButton className="piano-analyze" size="lg" variant="primary" disabled={!demo || !midi || busy} loading={busy} onClick={analyze}>{busy ? "Đang đọc audio và MIDI…" : "Phân tích sáng tác →"}</GlassButton>
  </div>;
}
function FileTile({ title, detail, accept, file, onChange }: { title: string; detail: string; accept: string; file?: File; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) { return <label className={`piano-file ${file ? "ready" : ""}`}><span className="piano-file-icon">{file ? "✓" : "+"}</span><b>{title}</b><small>{file?.name ?? detail}</small><input type="file" accept={accept} onChange={onChange} /></label>; }

function PianoReportView({ report, audioResult, bpm, keyName, setBpm, setKey, demoUrl, referenceUrl, demoName, audio, position, setPosition, onNew }: { report: PianoReport; audioResult: { bpm: number; bpmConfidence: number; key: string; keyConfidence: number; duration: number }; bpm: number; keyName: string; setBpm: (n: number) => void; setKey: (s: string) => void; demoUrl: string; referenceUrl: string; demoName: string; audio: React.RefObject<HTMLAudioElement | null>; position: number; setPosition: (n: number) => void; onNew: () => void }) {
  const [source, setSource] = useState<"demo" | "reference">("demo");
  const [playerDuration, setPlayerDuration] = useState(audioResult.duration);
  const resumeAfterLoad = useRef(false); const seekAfterLoad = useRef(0); const selectedUrl = source === "demo" ? demoUrl : referenceUrl;
  const changeSource = (next: "demo" | "reference") => { if (next === source || (next === "reference" && !referenceUrl)) return; const player = audio.current; resumeAfterLoad.current = Boolean(player && !player.paused); seekAfterLoad.current = player?.currentTime ?? position; setSource(next); };
  const loadedMetadata = (player: HTMLAudioElement) => { setPlayerDuration(player.duration); const nextPosition = Math.min(seekAfterLoad.current, player.duration || 0); player.currentTime = nextPosition; setPosition(nextPosition); if (resumeAfterLoad.current) void player.play(); resumeAfterLoad.current = false; };
  return <div className="content piano-report">
    <section className="piano-report-head"><div><p className="eyebrow">PIANO THƯ GIÃN · BÁO CÁO SÁNG TÁC</p><h1>{demoName}</h1><p>Các chỉ số minh bạch này chỉ hỗ trợ việc nghe và đánh giá, không phải kết luận khách quan.</p></div><div className="piano-score"><strong>{report.score}</strong><span>/ 100</span><small>ĐIỂM GIAI ĐIỆU</small></div><button onClick={onNew}>Đánh giá mới</button></section>
    <section className="piano-detection">
      <div><span>BPM audio</span><label><input aria-label="Chỉnh BPM" type="number" min="30" max="300" value={bpm} onChange={e => setBpm(Number(e.target.value))} /><small>Độ tin cậy {audioResult.bpmConfidence}% · có thể chỉnh</small></label></div>
      <div><span>Tông nhạc</span><label><input aria-label="Chỉnh tông nhạc" value={keyName} onChange={e => setKey(e.target.value)} /><small>Độ tin cậy {audioResult.keyConfidence}% · có thể chỉnh</small></label></div>
      <div><span>Tempo MIDI</span><strong>{report.bpm} BPM</strong></div><div><span>Nhịp</span><strong>{report.timeSignature}</strong></div><div><span>Tông MIDI</span><strong>{report.key}</strong></div><div><span>Thời lượng / âm vực</span><strong>{time(report.duration)} · {report.noteRange}</strong></div>
    </section>
    <section className="piano-viz"><header><h2>Bản đồ nốt (Piano Roll)</h2><span>{report.notes.length} nốt · vị trí phát {time(position)}</span></header><PianoRoll report={report} position={position} /><header><h2>Đường nét giai điệu</h2><span>Bè giai điệu cao nhất</span></header><Contour report={report} /></section>
    <section className="piano-chords"><header><h2>Dòng thời gian hợp âm</h2><b>{report.progression || "Chưa phát hiện vòng hợp âm ổn định"}</b></header><div>{report.chords.map((c, i) => <button key={`${c.start}-${i}`} style={{ flex: c.end - c.start }} onClick={() => { if (audio.current) audio.current.currentTime = c.start; }}><strong>{c.name}</strong><small>{c.roman} · {time(c.start)}</small></button>)}</div></section>
    <section className="piano-metrics"><header><h2>Chỉ số giai điệu</h2><span>Cách tính từng chỉ số</span></header><div>{report.metrics.map(m => <article key={m.label}><div><b>{m.label}</b><strong>{m.score}</strong></div><meter min="0" max="100" value={m.score} /><p>{m.explanation}</p></article>)}</div></section>
    <section className="piano-feedback"><div><h2>Nhận xét cho producer</h2><p>{producerFeedback(report)}</p><h3>Checklist khi nghe</h3><ul><li>Bạn có thể ngân nga mô-típ chính sau một lần nghe không?</li><li>Phần cuối mỗi câu nhạc có đủ khoảng trống để tạo cảm giác thư giãn không?</li><li>Đỉnh của mỗi đường nét giai điệu có tự nhiên thay vì ngẫu nhiên không?</li><li>Các nốt ngoài tông có tạo cảm giác được sử dụng có chủ đích không?</li><li>Kết câu cuối có tạo được cảm giác khép lại như mong muốn không?</li></ul></div><aside><b>Phạm vi đánh giá</b><p>Báo cáo này không đánh giá cân bằng tần số, độ rộng stereo, LUFS, compression, lựa chọn âm thanh, mixing hoặc mastering.</p></aside></section>
    <div className="piano-player"><audio ref={audio} src={selectedUrl} controls onLoadedMetadata={e => loadedMetadata(e.currentTarget)} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} /><div><button className={source === "demo" ? "active" : ""} onClick={() => changeSource("demo")}>Demo</button><button disabled={!referenceUrl} className={source === "reference" ? "active" : ""} onClick={() => changeSource("reference")}>Tham chiếu</button></div><span>{time(position)} / {time(playerDuration)}</span></div>
  </div>;
}
function PianoRoll({ report, position }: { report: PianoReport; position: number }) { const min = Math.min(...report.notes.map(n => n.note)); const max = Math.max(...report.notes.map(n => n.note)); return <svg className="piano-roll" viewBox="0 0 1000 280" role="img" aria-label="Bản đồ nốt MIDI"><g className="roll-grid">{Array.from({ length: 13 }, (_, i) => <line key={i} x1={i * 1000 / 12} x2={i * 1000 / 12} y1="0" y2="280" />)}</g>{report.notes.map((n, i) => <rect key={i} x={n.start / report.duration * 1000} y={(max - n.note) / Math.max(1, max - min + 1) * 260} width={Math.max(2, n.duration / report.duration * 1000)} height={Math.max(3, 250 / (max - min + 1))} rx="2" />)}<line className="playhead" x1={position / report.duration * 1000} x2={position / report.duration * 1000} y1="0" y2="280" /></svg>; }
function Contour({ report }: { report: PianoReport }) { const lead = melodyContourNotes(report.notes); const min = Math.min(...lead.map(n => n.note)); const max = Math.max(...lead.map(n => n.note)); const points = lead.map(n => `${n.start / report.duration * 1000},${170 - (n.note - min) / Math.max(1, max - min) * 150}`).join(" "); return <svg className="contour" viewBox="0 0 1000 190" role="img" aria-label="Đường nét giai điệu"><polyline points={points} /></svg>; }
function producerFeedback(report: PianoReport) { const low = [...report.metrics].sort((a, b) => a.score - b.score).slice(0, 2); const high = [...report.metrics].sort((a, b) => b.score - a.score)[0]; return `Điểm mạnh nhất hiện tại là ${high.label.toLowerCase()} (${high.score}/100). Ở lần chỉnh sửa tiếp theo, hãy tập trung vào ${low.map(x => x.label.toLowerCase()).join(" và ")}. Giữ lại những chất liệu dễ nhận biết, sau đó nghe lại từng thay đổi bằng tai; các chỉ số này mô tả dữ liệu MIDI chứ không quyết định giá trị cảm xúc của bản nhạc.`; }
