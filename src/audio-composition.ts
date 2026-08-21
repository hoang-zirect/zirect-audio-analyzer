import { analyzeEssentiaTempo, type EssentiaTempoEstimate } from "./essentia-tempo";

export type ConfidenceLabel = "Low" | "Medium" | "High";

export type ZirectTempoSource = {
  bpm: number;
  confidence: ConfidenceLabel;
  candidates: Array<{ bpm: number; score: number }>;
  ambiguous: boolean;
};

export type TempoCrossCheckStatus = "agreement" | "half-double" | "conflict" | "zirect-only" | "essentia-only" | "unavailable";

export type TempoCrossCheck = {
  zirect: ZirectTempoSource;
  essentia?: EssentiaTempoEstimate;
  essentiaError?: string;
  recommendedBpm: number;
  status: TempoCrossCheckStatus;
  needsConfirmation: boolean;
  message: string;
};

export type CompositionSection = {
  start: number; end: number; onsetDensity: number; restPercent: number;
  longestRest: number; phraseLength: number; repetition: number;
  melodicMovement: number; harmonicChangeRate: number; activity: number;
};

export type CompositionAnalysis = {
  duration: number; waveform: number[]; bpm: number; tempoStability: number; rubato: number;
  tempoCandidates: Array<{ bpm: number; score: number }>; tempoAmbiguous: boolean;
  tempoCrossCheck?: TempoCrossCheck;
  tonalCenter: string; onsetDensity: number; restPercent: number; longestRest: number;
  averagePhraseLength: number; introSilence: number; outroSilence: number; repetition: number;
  melodicMovement: number; harmonicChangeRate: number; activityPercent: number;
  sections: CompositionSection[]; confidence: Record<string, ConfidenceLabel>;
};

export type ComparisonFinding = { id: string; rank: number; demoStart: number; demoEnd: number; referenceStart: number; referenceEnd: number; score: number; textVi: string; textEn: string };
export type CompositionComparison = { rows: Array<{ label: string; demo: number; reference: number; unit: string }>; findings: ComparisonFinding[] };
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / Math.max(1, a.length);
const round = (n: number, p = 1) => Number(n.toFixed(p));
const confidence = (events: number, duration: number): ConfidenceLabel => events >= Math.max(12, duration / 3) ? "High" : events >= 4 ? "Medium" : "Low";

/** Decode once and reuse the AudioBuffer across the composition, tonal and AI passes. */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close();
  }
}

type TempoEstimate = { bpm: number; stability: number; confidence: ConfidenceLabel; candidates: Array<{ bpm: number; score: number }>; ambiguous: boolean };
const correlationAt = (values: number[], lag: number) => {
  const rounded = Math.max(1, Math.round(lag)); let xy = 0, xx = 0, yy = 0;
  for (let i = rounded; i < values.length; i++) { const x = values[i], y = values[i - rounded]; xy += x * y; xx += x * x; yy += y * y; }
  return xy / Math.max(1e-9, Math.sqrt(xx * yy));
};

/** Tempo from onset strength, using normalized autocorrelation, a harmonic comb and window agreement. */
export function estimateTempo(envelope: number[], frameSeconds: number): TempoEstimate {
  const duration = envelope.length * frameSeconds; const total = envelope.reduce((sum, value) => sum + value, 0);
  if (duration < 2 || total < 1e-5) return { bpm: 0, stability: 0, confidence: "Low", candidates: [], ambiguous: false };
  const scoreRange = (values: number[]) => Array.from({ length: 146 }, (_, index) => 35 + index).map(bpm => {
    const lag = 60 / bpm / frameSeconds;
    const autocorrelation = correlationAt(values, lag);
    const comb = autocorrelation + .38 * correlationAt(values, lag * 2) + .18 * correlationAt(values, lag * 3);
    return { bpm, raw: comb / 1.56 };
  });
  const global = scoreRange(envelope); const peakCandidates = global.filter((candidate, index, all) => candidate.raw >= (all[index - 1]?.raw ?? -1) && candidate.raw >= (all[index + 1]?.raw ?? -1)).sort((a,b)=>b.raw-a.raw);
  const strongest = peakCandidates[0] ?? { bpm: 0, raw: 0 };
  // Perfect pulse trains correlate at every integer multiple. Start with the fastest
  // comparably-supported peak, then step down only when alternating accents justify it.
  let selected = peakCandidates.filter(candidate=>candidate.raw>=strongest.raw*.97).sort((a,b)=>b.bpm-a.bpm)[0] ?? strongest;
  // Resolve half/double ambiguity through alternating accent strength. A real subdivision pattern
  // has materially stronger odd/even accents; an unaccented 120 BPM beat therefore stays at 120.
  const half = peakCandidates.find(candidate => Math.abs(candidate.bpm * 2 - selected.bpm) <= 3 && candidate.bpm <= 90);
  if (half && half.raw >= selected.raw * .82) {
    const fastLag = Math.max(1, Math.round(60 / selected.bpm / frameSeconds)); const pulses: number[] = [];
    for (let offset = 0; offset < fastLag; offset++) { const sampled = envelope.filter((_, index) => index % fastLag === offset); pulses.push(mean(sampled)); }
    const phase = pulses.indexOf(Math.max(...pulses)); const accents: number[] = [];
    for (let index = phase; index < envelope.length; index += fastLag) accents.push(envelope[index]);
    const even = mean(accents.filter((_, index) => index % 2 === 0)), odd = mean(accents.filter((_, index) => index % 2 === 1));
    const accentRatio = Math.max(even, odd) / Math.max(1e-6, Math.min(even, odd));
    if (accentRatio >= 1.22 || half.raw > selected.raw * 1.06) selected = half;
  }
  const windowFrames = Math.max(Math.round(12 / frameSeconds), Math.round(4 * 60 / Math.max(35, selected.bpm) / frameSeconds)); const windowBpms: number[] = [];
  for (let start = 0; start + windowFrames <= envelope.length; start += Math.max(1, Math.floor(windowFrames / 2))) { const local = scoreRange(envelope.slice(start,start+windowFrames)).sort((a,b)=>b.raw-a.raw); const related = local.filter(candidate => candidate.bpm >= selected.bpm * .72 && candidate.bpm <= selected.bpm * 1.38)[0]; if (related) windowBpms.push(related.bpm); }
  const agreement = windowBpms.length ? windowBpms.filter(bpm=>Math.abs(bpm-selected.bpm)<=Math.max(3,selected.bpm*.07)).length/windowBpms.length : .4;
  const spread = windowBpms.length ? Math.sqrt(mean(windowBpms.map(bpm=>(bpm-selected.bpm)**2))) / selected.bpm : .35; const stability = round(Math.max(0, Math.min(100, 100 - spread * 180)));
  const candidates = peakCandidates.filter((candidate,index,all)=>index===0||all.slice(0,index).every(other=>Math.abs(other.bpm-candidate.bpm)>4)).slice(0,3).map(candidate=>({bpm:candidate.bpm,score:round(candidate.raw*100)}));
  const runnerUp = peakCandidates.find(candidate=>Math.abs(candidate.bpm-selected.bpm)>4); const dominance = selected.raw / Math.max(.001,runnerUp?.raw ?? selected.raw*.5);
  const harmonicClose = peakCandidates.some(candidate => candidate.bpm !== selected.bpm && (Math.abs(candidate.bpm-selected.bpm*2)<=3 || Math.abs(candidate.bpm*2-selected.bpm)<=3) && candidate.raw>=selected.raw*.82);
  const quality = (Math.min(1,(dominance-1)/.35)*.35 + agreement*.35 + Math.min(1,duration/30)*.15 + stability/100*.15);
  let level: ConfidenceLabel = quality >= .72 ? "High" : quality >= .43 ? "Medium" : "Low"; if (stability < 60 || harmonicClose) level = level === "High" ? "Medium" : level;
  return { bpm:selected.bpm, stability, confidence:level, candidates, ambiguous:harmonicClose };
}

const validBpm = (value?: number) => Number.isFinite(value) && Number(value) >= 30 && Number(value) <= 220;

/**
 * Reconcile two independent tempo engines without hiding disagreement.
 * Piano Relaxing uses the slower metrical level for a clear half/double pair,
 * while still requiring the reviewer to confirm it by ear.
 */
export function reconcileTempoEstimates(zirect: ZirectTempoSource, essentia?: EssentiaTempoEstimate, essentiaError?: string): TempoCrossCheck {
  const zirectValid = validBpm(zirect.bpm), essentiaValid = validBpm(essentia?.bpm);
  if (!zirectValid && !essentiaValid) return {
    zirect, essentia, essentiaError, recommendedBpm: 0, status: "unavailable", needsConfirmation: true,
    message: "Cả hai bộ đo chưa tìm được BPM ổn định. Hãy nhập BPM thủ công.",
  };
  if (!essentiaValid) return {
    zirect, essentia, essentiaError, recommendedBpm: Math.round(zirect.bpm), status: "zirect-only", needsConfirmation: zirect.ambiguous,
    message: essentiaError ? "Essentia chưa khả dụng; kết quả đang dùng riêng bộ đo Zirect." : "Chưa có kết quả Essentia; kết quả đang dùng riêng bộ đo Zirect.",
  };
  if (!zirectValid) return {
    zirect, essentia, essentiaError, recommendedBpm: Math.round(essentia!.bpm), status: "essentia-only", needsConfirmation: true,
    message: "Bộ đo Zirect chưa tìm được nhịp; tạm dùng kết quả Essentia và cần xác nhận bằng tai.",
  };

  const zirectBpm = zirect.bpm, essentiaBpm = essentia!.bpm;
  const difference = Math.abs(zirectBpm - essentiaBpm);
  if (difference <= Math.max(3, Math.min(zirectBpm, essentiaBpm) * .05)) {
    const recommendedBpm = Math.round((zirectBpm + essentiaBpm) / 2);
    return {
      zirect, essentia, recommendedBpm, status: "agreement", needsConfirmation: false,
      message: `Hai bộ đo đồng thuận quanh ${recommendedBpm} BPM.`,
    };
  }

  const slower = Math.min(zirectBpm, essentiaBpm), faster = Math.max(zirectBpm, essentiaBpm);
  if (Math.abs(faster - slower * 2) <= Math.max(4, slower * .06)) {
    const recommendedBpm = Math.round(slower);
    return {
      zirect, essentia, recommendedBpm, status: "half-double", needsConfirmation: true,
      message: `Phát hiện quan hệ nửa/gấp đôi ${Math.round(slower)} ↔ ${Math.round(faster)} BPM. Đề xuất ${recommendedBpm} BPM cho Piano Relaxing; hãy xác nhận bằng tai.`,
    };
  }

  return {
    zirect, essentia, recommendedBpm: Math.round(zirectBpm), status: "conflict", needsConfirmation: true,
    message: `Hai bộ đo chênh lệch rõ (${Math.round(zirectBpm)} và ${Math.round(essentiaBpm)} BPM). Chưa thể tự kết luận; hãy nhập BPM đã kiểm tra bằng tai.`,
  };
}

/**
 * Phase-safe mono representation for feature extraction.
 *
 * A plain L+R average can turn an audible opposite-polarity stereo file into
 * silence. Keep the average when channels agree, otherwise preserve RMS energy
 * with the sign of the dominant channel. This is for analysis only and never
 * replaces the user's audio playback.
 */
export function downmixChannels(channels: Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array();
  const length = Math.min(...channels.map(channel => channel.length));
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0, squareSum = 0, dominant = 0;
    for (const channel of channels) {
      const sample = channel[i];
      sum += sample;
      squareSum += sample * sample;
      if (Math.abs(sample) > Math.abs(dominant)) dominant = sample;
    }
    const average = sum / channels.length;
    const rms = Math.sqrt(squareSum / channels.length);
    mono[i] = Math.abs(average) >= rms * .2 ? average : Math.sign(dominant || 1) * rms;
  }
  return mono;
}

export function analyzeCompositionSamples(data: Float32Array, sampleRate: number): CompositionAnalysis {
  const duration = data.length / sampleRate; const frameSeconds = .05; const frame = Math.max(1, Math.round(sampleRate * frameSeconds));
  const energy: number[] = []; const flux: number[] = []; let previous = 0;
  for (let i = 0; i < data.length; i += frame) { let sum = 0, movement = 0; for (let j = i; j < Math.min(data.length, i + frame); j++) { sum += data[j] ** 2; if (j > i) movement += Math.abs(data[j] - data[j - 1]); } const e = Math.sqrt(sum / Math.max(1, Math.min(frame, data.length - i))); energy.push(e); flux.push(movement / Math.max(1, frame) + Math.max(0, e - previous)); previous = e; }
  const peak = Math.max(...energy, 1e-8); const activeThreshold = Math.max(peak * .08, .0005); const active = energy.map(e => e > activeThreshold);
  const sortedFlux = [...flux].sort((a,b)=>a-b); const onsetThreshold = sortedFlux[Math.floor(sortedFlux.length * .82)] ?? 0;
  const onsets = flux.map((v,i) => v > onsetThreshold && v > (flux[i-1] ?? 0) * 1.08 && active[i] ? i * frameSeconds : -1).filter(v => v >= 0);
  const onsetEnvelope = flux.map((value, index) => active[index] ? Math.max(0, value - (flux[index - 1] ?? 0) * .35) : 0); const tempo = estimateTempo(onsetEnvelope, frameSeconds);
  const rests: Array<{start:number;end:number}> = []; let restStart = -1; active.forEach((v,i)=>{if(!v&&restStart<0)restStart=i; if(v&&restStart>=0){rests.push({start:restStart*frameSeconds,end:i*frameSeconds});restStart=-1;}}); if(restStart>=0)rests.push({start:restStart*frameSeconds,end:duration});
  const phraseRests = rests.filter(r=>r.end-r.start>=.45); const phraseStarts=[0,...phraseRests.map(r=>r.end)].filter(v=>v<duration); const phraseEnds=[...phraseRests.map(r=>r.start),duration]; const phrases=phraseStarts.map((v,i)=>Math.max(0,(phraseEnds[i]??duration)-v)).filter(v=>v>.15);
  const introSilence = rests[0]?.start === 0 ? rests[0].end : 0; const last = rests.at(-1); const outroSilence = last && Math.abs(last.end-duration)<.1 ? duration-last.start : 0;
  const contour = energy.map((e,i)=>active[i] ? flux[i] / Math.max(e,.0001) : 0); const movement = mean(contour.filter((_,i)=>active[i]));
  const motifBins = onsets.slice(1).map((v,i)=>Math.round((v-onsets[i])/.1)); let motifMatches=0; for(let i=0;i+7<motifBins.length;i++) if(motifBins.slice(i,i+4).join()===motifBins.slice(i+4,i+8).join()) motifMatches++;
  // Coarse zero-crossing/spectral-color change: a transparent proxy, never an exact chord claim.
  const color = energy.map((_,i)=>{let z=0;const start=i*frame;for(let j=start+1;j<Math.min(data.length,start+frame);j++)if((data[j]>=0)!==(data[j-1]>=0))z++;return z/frame;});
  const harmonicChanges=color.slice(1).filter((v,i)=>active[i+1]&&Math.abs(v-color[i])>.035).length / Math.max(duration/60,1/60);
  const sectionCount = Math.max(1, Math.min(8, Math.ceil(duration/15))); const sections: CompositionSection[]=[];
  for(let n=0;n<sectionCount;n++){const start=n/sectionCount*duration,end=(n+1)/sectionCount*duration;const a=Math.floor(start/frameSeconds),b=Math.ceil(end/frameSeconds);const localOnsets=onsets.filter(v=>v>=start&&v<end);const localRests=rests.map(r=>Math.max(0,Math.min(end,r.end)-Math.max(start,r.start))).filter(Boolean);const localColor=color.slice(a,b);sections.push({start,end,onsetDensity:round(localOnsets.length/Math.max((end-start)/60,1/60)),restPercent:round(localRests.reduce((s,v)=>s+v,0)/(end-start)*100),longestRest:round(Math.max(0,...localRests)),phraseLength:round(mean(phrases.filter((_,i)=>(phraseStarts[i]??0)>=start&&(phraseStarts[i]??0)<end))||end-start),repetition:round(motifMatches/Math.max(1,motifBins.length)*100),melodicMovement:round(mean(contour.slice(a,b))*100),harmonicChangeRate:round(localColor.slice(1).filter((v,i)=>Math.abs(v-localColor[i])>.035).length/Math.max((end-start)/60,1/60)),activity:round(active.slice(a,b).filter(Boolean).length/Math.max(1,b-a)*100)});}
  const waveform=Array.from({length:180},(_,i)=>Math.max(0,...energy.slice(Math.floor(i*energy.length/180),Math.max(Math.floor(i*energy.length/180)+1,Math.floor((i+1)*energy.length/180))))/peak);
  // Tonal center uses autocorrelation-like sinusoidal projections over a bounded sample.
  const chroma=Array(12).fill(0); const stride=Math.max(1,Math.floor(data.length/60000)); for(let midi=36;midi<=83;midi++){const freq=440*2**((midi-69)/12);let re=0,im=0;for(let i=0;i<data.length;i+=stride){const p=2*Math.PI*freq*i/sampleRate;re+=data[i]*Math.cos(p);im-=data[i]*Math.sin(p);}chroma[midi%12]+=Math.hypot(re,im);} const tonic=chroma.indexOf(Math.max(...chroma)); const c=confidence(onsets.length,duration);
  const zirectTempo: ZirectTempoSource = { bpm: tempo.bpm, confidence: tempo.confidence, candidates: tempo.candidates, ambiguous: tempo.ambiguous };
  return {duration, waveform, bpm:tempo.bpm, tempoStability:tempo.stability,rubato:round(100-tempo.stability),tempoCandidates:tempo.candidates,tempoAmbiguous:tempo.ambiguous,tempoCrossCheck:reconcileTempoEstimates(zirectTempo),tonalCenter:peak<.001?"Không xác định":NAMES[tonic],onsetDensity:round(onsets.length/Math.max(duration/60,1/60)),restPercent:round(active.filter(v=>!v).length/Math.max(1,active.length)*100),longestRest:round(Math.max(0,...rests.map(r=>r.end-r.start))),averagePhraseLength:round(mean(phrases)),introSilence:round(introSilence),outroSilence:round(outroSilence),repetition:round(motifMatches/Math.max(1,motifBins.length)*100),melodicMovement:round(movement*100),harmonicChangeRate:round(harmonicChanges),activityPercent:round(active.filter(Boolean).length/Math.max(1,active.length)*100),sections,confidence:{tempo:tempo.confidence,rubato:tempo.confidence,tonalCenter:peak>.01?"Medium":"Low",onsets:c,phrasing:phraseRests.length>=2?"High":phraseRests.length?"Medium":"Low",repetition:onsets.length>=16?"Medium":"Low",melodicMovement:c,harmonicChange:c,sections:duration>=30?"High":"Medium"}};
}

function linearResample(data: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return data.slice();
  const output = new Float32Array(Math.max(1, Math.ceil(data.length / sourceRate * targetRate)));
  for (let index = 0; index < output.length; index++) {
    const position = index * sourceRate / targetRate;
    const left = Math.min(data.length - 1, Math.floor(position));
    const right = Math.min(data.length - 1, left + 1);
    const amount = position - left;
    output[index] = data[left] * (1 - amount) + data[right] * amount;
  }
  return output;
}

async function resampleForEssentia(data: Float32Array, sourceRate: number) {
  const targetRate = 44100;
  if (sourceRate === targetRate) return data.slice();
  try {
    const length = Math.max(1, Math.ceil(data.length / sourceRate * targetRate));
    const context = new OfflineAudioContext(1, length, targetRate);
    const buffer = context.createBuffer(1, data.length, sourceRate);
    buffer.copyToChannel(new Float32Array(data), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    return (await context.startRendering()).getChannelData(0).slice();
  } catch {
    return linearResample(data, sourceRate, targetRate);
  }
}

export async function analyzeCompositionAudio(file: File, decodedBuffer?: AudioBuffer): Promise<CompositionAnalysis> {
  const buffer = decodedBuffer ?? await decodeAudioFile(file);
  const mono = downmixChannels(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)));
  const result = analyzeCompositionSamples(mono, buffer.sampleRate);
  const zirect = result.tempoCrossCheck!.zirect;
  try {
    const essentia = await analyzeEssentiaTempo(await resampleForEssentia(mono, buffer.sampleRate));
    const tempoCrossCheck = reconcileTempoEstimates(zirect, essentia);
    return {
      ...result,
      bpm: tempoCrossCheck.recommendedBpm,
      tempoAmbiguous: result.tempoAmbiguous || tempoCrossCheck.needsConfirmation,
      tempoCrossCheck,
    };
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : "Essentia chưa khả dụng.";
    return { ...result, tempoCrossCheck: reconcileTempoEstimates(zirect, undefined, error) };
  }
}

const sectionKeys: Array<keyof Omit<CompositionSection, "start" | "end">> = ["onsetDensity", "restPercent", "longestRest", "phraseLength", "repetition", "melodicMovement", "harmonicChangeRate", "activity"];

/** Resample a track into equal normalized bins without omitting any time range. */
export function resampleCompositionSections(analysis: CompositionAnalysis, count = 8): CompositionSection[] {
  return Array.from({ length: count }, (_, index) => {
    const start = index / count * analysis.duration;
    const end = (index + 1) / count * analysis.duration;
    const overlaps = analysis.sections.map(section => ({
      section,
      weight: Math.max(0, Math.min(end, section.end) - Math.max(start, section.start)),
    })).filter(item => item.weight > 0);
    const totalWeight = overlaps.reduce((sum, item) => sum + item.weight, 0) || 1;
    const values = Object.fromEntries(sectionKeys.map(key => {
      if (key === "longestRest") return [key, round(Math.max(0, ...overlaps.map(item => item.section.longestRest)))];
      return [key, round(overlaps.reduce((sum, item) => sum + Number(item.section[key]) * item.weight, 0) / totalWeight)];
    })) as Omit<CompositionSection, "start" | "end">;
    return { start, end, ...values };
  });
}

export function compareCompositions(demo: CompositionAnalysis, reference: CompositionAnalysis): CompositionComparison {
  const demoBins = resampleCompositionSections(demo);
  const referenceBins = resampleCompositionSections(reference);
  const row=(label:string,key:keyof CompositionSection,unit:string)=>({label,demo:round(mean(demoBins.map(s=>Number(s[key])))),reference:round(mean(referenceBins.map(s=>Number(s[key])))),unit});
  const rows=[row("Mật độ tiếng đàn","onsetDensity","/phút"),row("Thời gian nghỉ ước lượng","restPercent","%"),row("Độ dài câu ước lượng","phraseLength","s"),{label:"BPM đã xác nhận",demo:demo.bpm,reference:reference.bpm,unit:"BPM"},row("Lặp mẫu nhịp onset","repetition","%"),row("Biến đổi màu âm","harmonicChangeRate","/phút"),{label:"Intro / outro",demo:round(demo.introSilence+demo.outroSilence),reference:round(reference.introSilence+reference.outroSilence),unit:"s"},row("Biến động onset/năng lượng","melodicMovement","")];
  const findings=demoBins.map((d,i)=>{const r=referenceBins[i];const densityPct=r.onsetDensity?round((d.onsetDensity-r.onsetDensity)/r.onsetDensity*100):round(d.onsetDensity?100:0);const diffs=[Math.abs(densityPct)/50,Math.abs(d.restPercent-r.restPercent)/25,Math.abs(d.phraseLength-r.phraseLength)/5,Math.abs(d.repetition-r.repetition)/25,Math.abs(d.harmonicChangeRate-r.harmonicChangeRate)/20,Math.abs(d.melodicMovement-r.melodicMovement)/25];const score=round(mean(diffs),2);const busy=densityPct>=0?`${Math.abs(densityPct)}% cao hơn`:`${Math.abs(densityPct)}% thấp hơn`;return{id:`comparison-${i}`,rank:0,demoStart:d.start,demoEnd:d.end,referenceStart:r.start,referenceEnd:r.end,score,textVi:`${formatTime(d.start)}–${formatTime(d.end)}: Demo có mật độ tiếng đàn ${busy} và khoảng nghỉ dài nhất ${d.longestRest<r.longestRest?"ngắn hơn":"dài hơn"} Reference ở đoạn tương đương. Nghe lại để xác nhận cảm giác dày/thưa bằng tai.`,textEn:`${formatTime(d.start)}–${formatTime(d.end)}: Demo piano-event density is ${Math.abs(densityPct)}% ${densityPct>=0?"higher":"lower"}, with a ${d.longestRest<r.longestRest?"shorter":"longer"} longest pause than the equivalent Reference section. Confirm the pacing difference by ear.`};}).sort((a,b)=>b.score-a.score).map((f,i)=>({...f,rank:i+1})); return {rows,findings};
}
const formatTime=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
