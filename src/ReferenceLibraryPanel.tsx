import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { analyzeCompositionAudio } from "./audio-composition";
import { transcribePianoAudio } from "./piano-transcription";
import {
  MAXIMUM_REFERENCE_TRACKS,
  MINIMUM_REFERENCE_TRACKS,
  buildReferenceProfile,
  createReferenceTrack,
  exportReferenceProfile,
  importReferenceProfile,
  profileIsReady,
  removeReferenceTrack,
  renameReferenceProfile,
  updateReferenceTrackBpm,
  type ReferenceLibraryProfile,
} from "./reference-profile";

const AUDIO_ACCEPT = ".wav,.flac,.mp3,.m4a,.aac,.ogg,.opus";

type Progress = { current: number; total: number; name: string; phase: string; percent: number };

export function ReferenceLibraryPanel({ profile, onChange, onBusyChange }: { profile?: ReferenceLibraryProfile; onChange: (profile?: ReferenceLibraryProfile) => void; onBusyChange?: (busy: boolean) => void }) {
  const [name, setName] = useState(profile?.name ?? "Zirect Piano Reference");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [message, setMessage] = useState("");
  const audioInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (profile?.name) setName(profile.name); }, [profile?.name]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const available = MAXIMUM_REFERENCE_TRACKS - (profile?.tracks.length ?? 0);
    const files = Array.from(event.target.files ?? []).slice(0, available);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true); setMessage("");
    let working = profile ?? buildReferenceProfile(name, []);
    const warnings: string[] = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (working.tracks.some(track => track.name === file.name)) { warnings.push(`${file.name}: đã có trong hồ sơ.`); continue; }
      try {
        setProgress({ current: index + 1, total: files.length, name: file.name, phase: "Đọc nhịp và bố cục", percent: 0 });
        const composition = await analyzeCompositionAudio(file);
        let transcription;
        try {
          setProgress({ current: index + 1, total: files.length, name: file.name, phase: "AI chép nốt piano", percent: 0 });
          transcription = await transcribePianoAudio(file, percent => setProgress({ current: index + 1, total: files.length, name: file.name, phase: "AI chép nốt piano", percent: Math.round(percent) }));
        } catch {
          warnings.push(`${file.name}: không chép được nốt, vẫn giữ phân tích audio.`);
        }
        working = buildReferenceProfile(name, [...working.tracks, createReferenceTrack(file.name, composition, transcription)], working.id);
        onChange(working);
      } catch {
        warnings.push(`${file.name}: không đọc được tệp.`);
      }
    }
    setProgress(undefined); setBusy(false);
    setMessage(warnings.length ? warnings.join(" ") : `Đã cập nhật hồ sơ với ${working.tracks.length} bài.`);
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try { const imported = importReferenceProfile(await file.text()); onChange(imported); setMessage(`Đã nhập hồ sơ ${imported.name}.`); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Không thể nhập hồ sơ."); }
  };

  const download = () => {
    if (!profile) return;
    const url = URL.createObjectURL(new Blob([exportReferenceProfile(profile)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${profile.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "zirect-piano-reference"}.json`; anchor.click();
    URL.revokeObjectURL(url);
  };

  const count = profile?.tracks.length ?? 0;
  const coverage = profile ? Math.round(profile.tracks.filter(track => track.transcription).length / Math.max(1, count) * 100) : 0;
  return <section className="reference-library">
    <header><div><p className="eyebrow">HỒ SƠ THAM CHIẾU DÙNG LẠI</p><h2>Zirect Piano Reference Profile</h2><p>Tải 5–10 bài Piano Relaxing tốt một lần. Trình duyệt chỉ lưu thống kê đã trích xuất — không lưu audio hay chuỗi nốt gốc.</p></div><strong className={profileIsReady(profile) ? "ready" : ""}>{count}<small>/{MINIMUM_REFERENCE_TRACKS} tối thiểu</small></strong></header>
    <div className="reference-profile-controls"><label>Tên hồ sơ<input value={name} onChange={event => setName(event.target.value)} onBlur={() => profile && onChange(renameReferenceProfile(profile, name))} /></label><div><button disabled={busy || count >= MAXIMUM_REFERENCE_TRACKS} onClick={() => audioInput.current?.click()}>+ Thêm nhiều bài</button><button disabled={!profile || busy} onClick={download}>Xuất JSON</button><button disabled={busy} onClick={() => importInput.current?.click()}>Nhập JSON</button>{profile && <button className="danger" disabled={busy} onClick={() => { if (window.confirm("Xoá hồ sơ tham chiếu trên thiết bị này?")) { onChange(undefined); setMessage("Đã xoá hồ sơ trên thiết bị."); } }}>Xoá hồ sơ</button>}</div><input ref={audioInput} hidden multiple type="file" accept={AUDIO_ACCEPT} onChange={addFiles} /><input ref={importInput} hidden type="file" accept="application/json,.json" onChange={importJson} /></div>
    {progress && <div className="reference-progress"><div><b>{progress.current}/{progress.total} · {progress.name}</b><span>{progress.phase} · {progress.percent}%</span></div><progress max="100" value={progress.percent} /></div>}
    {message && <p className="reference-message" role="status">{message}</p>}
    {profile && <><div className="reference-profile-summary"><article><span>Trạng thái</span><strong>{profileIsReady(profile) ? "Sẵn sàng đánh giá" : `Cần thêm ${MINIMUM_REFERENCE_TRACKS - count} bài`}</strong></article><article><span>Phủ AI chép nốt</span><strong>{coverage}%</strong></article><article><span>Dữ liệu lưu</span><strong>Chỉ đặc trưng</strong></article></div><div className="reference-track-list">{profile.tracks.map((track, index) => <article key={track.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{track.name}</b><small>{track.transcription ? "Có AI top-voice" : "Chỉ phân tích audio"}</small></div><label>BPM<input type="number" min="30" max="200" defaultValue={track.composition.confirmedBpm || ""} onBlur={event => { const bpm = Number(event.target.value); if (bpm >= 30 && bpm <= 200) onChange(updateReferenceTrackBpm(profile, track.id, bpm)); }} /></label><button aria-label={`Xoá ${track.name}`} onClick={() => onChange(removeReferenceTrack(profile, track.id))}>×</button></article>)}</div></>}
    {!profile && <div className="reference-empty"><p>Chưa có hồ sơ. Chọn đồng thời 5–10 tệp audio; hệ thống sẽ xử lý tuần tự ngay trên thiết bị.</p><button onClick={() => audioInput.current?.click()}>Chọn các bài tham chiếu</button></div>}
    <footer><b>Đây là hồ sơ thống kê, không phải mô hình tự huấn luyện.</b><span>Điểm “phù hợp hồ sơ” cho biết Demo nằm gần vùng thường gặp đến đâu; không phải điểm hay/dở.</span></footer>
  </section>;
}
