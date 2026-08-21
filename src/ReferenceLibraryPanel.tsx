import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { analyzeCompositionAudio, decodeAudioFile } from "./audio-composition";
import { transcribePianoAudio } from "./piano-transcription";
import {
  MAXIMUM_REFERENCE_TRACKS,
  MAXIMUM_REFERENCE_PROFILE_JSON_SIZE,
  MINIMUM_REFERENCE_TRACKS,
  assessReferenceProfile,
  buildReferenceProfile,
  createReferenceTrack,
  exportReferenceProfile,
  importReferenceProfile,
  referenceTrackHasVerifiedTempo,
  removeReferenceTrack,
  renameReferenceProfile,
  updateReferenceTrackBpm,
  type ReferenceLibraryProfile,
} from "./reference-profile";

const AUDIO_ACCEPT = ".wav,.flac,.mp3,.m4a,.aac,.ogg,.opus";
const AUDIO_EXTENSIONS = new Set(AUDIO_ACCEPT.split(",").map(extension => extension.slice(1)));
const MAXIMUM_AUDIO_SIZE = 300 * 1024 * 1024;

type Progress = { current: number; total: number; name: string; phase: string; percent: number };

export function ReferenceLibraryPanel({ profile, onChange, onBusyChange }: { profile?: ReferenceLibraryProfile; onChange: (profile?: ReferenceLibraryProfile) => void; onBusyChange?: (busy: boolean) => void }) {
  const [name, setName] = useState(profile?.name ?? "Zirect Piano Reference");
  const [busy, setBusy] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [message, setMessage] = useState("");
  const audioInput = useRef<HTMLInputElement>(null);
  const rebuildInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const cancelRequested = useRef(false);
  useEffect(() => { if (profile?.name) setName(profile.name); }, [profile?.name]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const processFiles = async (event: ChangeEvent<HTMLInputElement>, replaceProfile = false) => {
    const available = replaceProfile ? MAXIMUM_REFERENCE_TRACKS : MAXIMUM_REFERENCE_TRACKS - (profile?.tracks.length ?? 0);
    const files = Array.from(event.target.files ?? []).slice(0, available);
    event.target.value = "";
    if (!files.length) return;
    if (replaceProfile && files.length < MINIMUM_REFERENCE_TRACKS) {
      setMessage(`Hãy chọn ít nhất ${MINIMUM_REFERENCE_TRACKS} bài để nâng cấp hồ sơ. Hồ sơ hiện tại vẫn được giữ nguyên.`);
      return;
    }
    cancelRequested.current = false;
    setBusy(true); setRebuilding(replaceProfile); setMessage("");
    let working = replaceProfile ? buildReferenceProfile(name, [], profile?.id) : profile ?? buildReferenceProfile(name, []);
    const warnings: string[] = [];
    try {
      for (let index = 0; index < files.length; index++) {
        if (cancelRequested.current) break;
        const file = files[index];
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!AUDIO_EXTENSIONS.has(extension)) { warnings.push(`${file.name}: định dạng không được hỗ trợ.`); continue; }
        if (file.size > MAXIMUM_AUDIO_SIZE) { warnings.push(`${file.name}: vượt giới hạn 300 MB.`); continue; }
        if (working.tracks.some(track => track.name === file.name)) { warnings.push(`${file.name}: đã có trong hồ sơ.`); continue; }
        try {
          setProgress({ current: index + 1, total: files.length, name: file.name, phase: "Giải mã audio", percent: 0 });
          const decoded = await decodeAudioFile(file);
          setProgress({ current: index + 1, total: files.length, name: file.name, phase: "Đọc nhịp và bố cục", percent: 0 });
          const composition = await analyzeCompositionAudio(file, decoded);
          if (composition.tempoCrossCheck?.needsConfirmation) warnings.push(`${file.name}: ${composition.tempoCrossCheck.message}`);
          let transcription;
          try {
            if (cancelRequested.current) throw new Error("Đã dừng theo yêu cầu.");
            setProgress({ current: index + 1, total: files.length, name: file.name, phase: "AI chép nốt piano", percent: 0 });
            transcription = await transcribePianoAudio(file, percent => setProgress({ current: index + 1, total: files.length, name: file.name, phase: "AI chép nốt piano", percent: Math.round(percent) }), decoded);
          } catch (reason) {
            if (cancelRequested.current) break;
            warnings.push(`${file.name}: không chép được nốt, vẫn giữ phân tích audio.`);
          }
          working = buildReferenceProfile(name, [...working.tracks, createReferenceTrack(file.name, composition, transcription)], working.id);
          if (!replaceProfile) onChange(working);
        } catch (reason) {
          warnings.push(`${file.name}: ${reason instanceof Error ? reason.message : "không đọc được tệp."}`);
        }
      }
      if (cancelRequested.current) {
        setMessage(replaceProfile ? "Đã dừng. Hồ sơ cũ vẫn được giữ nguyên." : `Đã dừng sau ${working.tracks.length} bài trong hồ sơ.`);
        return;
      }
      if (replaceProfile && working.tracks.length < MINIMUM_REFERENCE_TRACKS) {
        setMessage(`Chỉ phân tích thành công ${working.tracks.length}/${MINIMUM_REFERENCE_TRACKS} bài tối thiểu nên hồ sơ cũ vẫn được giữ nguyên. ${warnings.join(" ")}`.trim());
        return;
      }
      if (replaceProfile) onChange(working);
      const resultHealth = assessReferenceProfile(working);
      const success = `Đã xử lý ${working.tracks.length} bài: ${resultHealth.dualTempoCount} bài có BPM Essentia, ${resultHealth.verifiedTempoCount} bài có BPM đủ tin cậy.`;
      setMessage(warnings.length ? `${success} ${warnings.join(" ")}` : success);
    } finally {
      setProgress(undefined); setBusy(false); setRebuilding(false);
    }
  };

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => processFiles(event);
  const rebuildProfile = (event: ChangeEvent<HTMLInputElement>) => processFiles(event, true);

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try { if (file.size > MAXIMUM_REFERENCE_PROFILE_JSON_SIZE) throw new Error("Hồ sơ JSON vượt quá giới hạn 2 MB."); const imported = importReferenceProfile(await file.text()); onChange(imported); setMessage(`Đã nhập hồ sơ ${imported.name}.`); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Không thể nhập hồ sơ."); }
  };

  const download = () => {
    if (!profile) return;
    const url = URL.createObjectURL(new Blob([exportReferenceProfile(profile)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${profile.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "zirect-piano-reference"}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const count = profile?.tracks.length ?? 0;
  const health = assessReferenceProfile(profile);
  const coverage = profile ? Math.round(health.transcriptionCount / Math.max(1, count) * 100) : 0;
  const fallbackTempoCount = profile?.tracks.filter(track => track.composition.tempoSources && !Number.isFinite(track.composition.tempoSources.essentiaBpm)).length ?? 0;
  const legacyTempoCount = profile?.tracks.filter(track => !track.composition.tempoSources).length ?? 0;
  const essentiaErrors = [...new Set(profile?.tracks.map(track => track.composition.tempoSources?.essentiaError).filter((error): error is string => Boolean(error)) ?? [])];
  return <section className="reference-library">
    <header><div><p className="eyebrow">HỒ SƠ THAM CHIẾU DÙNG LẠI</p><h2>Zirect Piano Reference Profile</h2><p>Tải 5–10 bài Piano Relaxing tốt một lần. Trình duyệt chỉ lưu thống kê đã trích xuất — không lưu audio hay chuỗi nốt gốc.</p></div><strong className={health.status !== "insufficient" ? "ready" : ""}>{count}<small>/{MINIMUM_REFERENCE_TRACKS} tối thiểu</small></strong></header>
    <div className="reference-profile-controls"><label>Tên hồ sơ<input value={name} onChange={event => setName(event.target.value)} onBlur={() => profile && onChange(renameReferenceProfile(profile, name))} /></label><div><button disabled={busy || count >= MAXIMUM_REFERENCE_TRACKS} onClick={() => audioInput.current?.click()}>+ Thêm nhiều bài</button><button disabled={!profile || busy} onClick={download}>Xuất JSON</button><button disabled={busy} onClick={() => importInput.current?.click()}>Nhập JSON</button>{profile && <button className="danger" disabled={busy} onClick={() => { if (window.confirm("Xoá hồ sơ tham chiếu trên thiết bị này?")) { onChange(undefined); setMessage("Đã xoá hồ sơ trên thiết bị."); } }}>Xoá hồ sơ</button>}</div><input ref={audioInput} hidden multiple type="file" accept={AUDIO_ACCEPT} onChange={addFiles} /><input ref={rebuildInput} hidden multiple type="file" accept={AUDIO_ACCEPT} onChange={rebuildProfile} /><input ref={importInput} hidden type="file" accept="application/json,.json" onChange={importJson} /></div>
    {progress && <div className="reference-progress"><div><b>{progress.current}/{progress.total} · {progress.name}</b><span>{progress.phase} · {progress.percent}%</span></div><progress max="100" value={progress.percent} /><button type="button" onClick={() => { cancelRequested.current = true; setMessage("Đang dừng sau bước hiện tại…"); }}>Dừng</button></div>}
    {message && <p className="reference-message" role="status">{message}</p>}
    {profile && rebuilding && <div className="reference-upgrade-notice processing"><div><b>Đang phân tích lại và thử đối chiếu Essentia</b><span>Danh sách bên dưới là dữ liệu cũ được giữ tạm trong lúc xử lý. Nhãn và toàn bộ bài sẽ được cập nhật sau khi hoàn tất ít nhất {MINIMUM_REFERENCE_TRACKS} bài.</span></div></div>}
    {profile && !rebuilding && legacyTempoCount > 0 && <div className="reference-upgrade-notice"><div><b>{legacyTempoCount} bài đang dùng kết quả BPM cũ</b><span>Hồ sơ không lưu audio gốc nên không thể tự chạy Essentia lại. Chọn lại 5–10 tệp audio; dữ liệu hiện tại chỉ được thay thế sau khi xử lý thành công.</span></div><button disabled={busy} onClick={() => rebuildInput.current?.click()}>Chọn lại audio để nâng cấp</button></div>}
    {profile && !rebuilding && fallbackTempoCount > 0 && <div className="reference-upgrade-notice fallback"><div><b>{fallbackTempoCount} bài đã chạy lại nhưng Essentia không trả BPM</b><span>{essentiaErrors[0] ? `Lỗi ghi nhận: ${essentiaErrors[0]}` : "Các bài này đang dùng riêng kết quả Zirect, không phải hồ sơ cũ."} Có thể thử lại hoặc nhập BPM đã xác nhận bằng tai.</span></div><button disabled={busy} onClick={() => rebuildInput.current?.click()}>Thử phân tích lại</button></div>}
    {profile && <><div className="reference-profile-summary"><article><span>Trạng thái</span><strong>{health.status === "ready" ? "Sẵn sàng đầy đủ" : health.status === "limited" ? "Sẵn sàng giới hạn" : `Cần thêm ${MINIMUM_REFERENCE_TRACKS - count} bài`}</strong></article><article><span>BPM đủ tin cậy</span><strong>{health.verifiedTempoCount}/{count} bài</strong></article><article><span>Phủ AI chép nốt</span><strong>{coverage}%</strong></article></div>{health.status === "limited" && <p className="reference-message">Hồ sơ đã đủ số bài để so sánh audio, nhưng một số kết luận BPM hoặc giai điệu bị giới hạn. Cần ít nhất {health.requiredCoverageCount} bài có BPM xác nhận và AI chép nốt để đạt trạng thái đầy đủ.</p>}<div className="reference-track-list">{profile.tracks.map((track, index) => { const tempoSources = track.composition.tempoSources; const manuallyConfirmed = track.composition.bpmManuallyConfirmed === true; const verified = referenceTrackHasVerifiedTempo(track); const tempoLabel = rebuilding ? "Đang nâng cấp · dữ liệu cũ tạm thời" : manuallyConfirmed ? `BPM ${track.composition.confirmedBpm} · đã xác nhận thủ công` : tempoSources?.status === "agreement" ? `Hai nguồn đồng thuận · Zirect ${tempoSources.zirectBpm} / Essentia ${tempoSources.essentiaBpm} BPM` : !tempoSources ? "Hồ sơ cũ · cần chọn lại audio hoặc xác nhận BPM" : Number.isFinite(tempoSources.essentiaBpm) ? `Hai nguồn chưa đồng thuận · Zirect ${tempoSources.zirectBpm} / Essentia ${tempoSources.essentiaBpm} BPM` : "Essentia không trả BPM · cần xác nhận thủ công"; const tempoClass = rebuilding ? "tempo-pending" : verified ? "tempo-dual-source" : tempoSources ? "tempo-fallback" : "tempo-legacy"; return <article key={track.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{track.name}</b><small>{track.transcription ? "Có AI top-voice" : "Chỉ phân tích audio"}</small><small className={tempoClass}>{tempoLabel}</small></div><label>BPM<input key={`${track.id}-${track.composition.confirmedBpm}-${manuallyConfirmed}`} type="number" min="30" max="200" defaultValue={track.composition.confirmedBpm || ""} onBlur={event => { const bpm = Number(event.target.value); if (bpm >= 30 && bpm <= 200) onChange(updateReferenceTrackBpm(profile, track.id, bpm)); }} /></label><button aria-label={`Xoá ${track.name}`} onClick={() => onChange(removeReferenceTrack(profile, track.id))}>×</button></article>; })}</div></>}
    {!profile && <div className="reference-empty"><p>Chưa có hồ sơ. Chọn đồng thời 5–10 tệp audio; hệ thống sẽ xử lý tuần tự ngay trên thiết bị.</p><button onClick={() => audioInput.current?.click()}>Chọn các bài tham chiếu</button></div>}
    <footer><b>Đây là hồ sơ thống kê, không phải mô hình tự huấn luyện.</b><span>Điểm “phù hợp hồ sơ” cho biết Demo nằm gần vùng thường gặp đến đâu; không phải điểm hay/dở.</span></footer>
  </section>;
}
