import { describe, expect, it } from "vitest";
import { analyzeCompositionSamples, compareCompositions, downmixChannels, reconcileTempoEstimates, type CompositionAnalysis, type ZirectTempoSource } from "./audio-composition";
const pulse=(seconds=12,sr=1000)=>{const a=new Float32Array(seconds*sr);for(let p=500;p<a.length;p+=500)for(let i=p;i<Math.min(p+20,a.length);i++)a[i]=.8;return a};
describe("audio composition analysis",()=>{
 it("preserves audible energy when stereo channels have opposite polarity",()=>expect(Array.from(downmixChannels([new Float32Array([1,-1]),new Float32Array([-1,1])]))).toEqual([1,-1]));
 it("handles silence/onset-free audio without NaN",()=>{const r=analyzeCompositionSamples(new Float32Array(4000),1000);expect(r.bpm).toBe(0);expect(r.restPercent).toBe(100);expect(Number.isFinite(r.onsetDensity)).toBe(true)});
 it("detects rest and phrase boundaries",()=>{const a=pulse();a.fill(0,4000,6000);const r=analyzeCompositionSamples(a,1000);expect(r.longestRest).toBeGreaterThan(1.5);expect(r.averagePhraseLength).toBeGreaterThan(0)});
 it("compares every normalized time bin when section counts differ",()=>{const a=analyzeCompositionSamples(pulse(16),1000),b=analyzeCompositionSamples(pulse(32),1000);expect(a.sections.length).not.toBe(b.sections.length);b.sections[0].onsetDensity=400;const c=compareCompositions(a,b);expect(c.rows).toHaveLength(8);expect(c.findings).toHaveLength(8);expect(c.findings[0].rank).toBe(1);expect(c.findings.every((f,i)=>i===0||c.findings[i-1].score>=f.score)).toBe(true)});
});

const tempoSignal=(bpm:number, seconds=48, subdivision=false, rubato=false, sr=1000)=>{const data=new Float32Array(seconds*sr);let beat=0,index=0;while(beat<seconds){const eighth=60/bpm/2;const count=subdivision?2:1;for(let sub=0;sub<count;sub++){const at=beat+sub*eighth;const amplitude=sub===0?1:.34;const start=Math.round(at*sr);for(let i=0;i<35&&start+i<data.length;i++)data[start+i]+=amplitude*Math.exp(-i/10)}index++;beat+=60/bpm*(rubato?1+Math.sin(index*.8)*.055:1)}return data};
describe("robust musical tempo",()=>{
 it("chooses 55 BPM over eighth-note double time",()=>expect(analyzeCompositionSamples(tempoSignal(55,48,true),1000).bpm).toBeGreaterThanOrEqual(52));
 it("keeps the accented 55 BPM estimate below double time",()=>expect(analyzeCompositionSamples(tempoSignal(55,48,true),1000).bpm).toBeLessThanOrEqual(58));
 it("keeps mildly rubato 55 BPM in the 50–60 range",()=>{const bpm=analyzeCompositionSamples(tempoSignal(55,55,true,true),1000).bpm;expect(bpm).toBeGreaterThanOrEqual(50);expect(bpm).toBeLessThanOrEqual(60)});
 it("preserves a genuine clear 120 BPM pulse",()=>{const bpm=analyzeCompositionSamples(tempoSignal(120),1000).bpm;expect(bpm).toBeGreaterThanOrEqual(116);expect(bpm).toBeLessThanOrEqual(124)});
 it("returns unknown and Low confidence for silence",()=>{const r=analyzeCompositionSamples(new Float32Array(10000),1000);expect(r.bpm).toBe(0);expect(r.confidence.tempo).toBe("Low")});
 it("never reports High confidence below 60% stability",()=>{const r=analyzeCompositionSamples(tempoSignal(55,16,true,true),1000);if(r.tempoStability<60)expect(r.confidence.tempo).not.toBe("High")});
});

const zirectTempo = (bpm: number): ZirectTempoSource => ({ bpm, confidence: "High", candidates: [{ bpm, score: 90 }], ambiguous: false });
describe("Zirect + Essentia tempo cross-check", () => {
 it("treats nearby estimates as agreement",()=>{const result=reconcileTempoEstimates(zirectTempo(55),{bpm:56,confidence:2.4,candidates:[56],algorithm:"PercivalBpmEstimator"});expect(result.status).toBe("agreement");expect(result.recommendedBpm).toBe(56);expect(result.needsConfirmation).toBe(false)});
 it("prefers the slow Piano Relaxing level for a half/double pair",()=>{const result=reconcileTempoEstimates(zirectTempo(55),{bpm:110,confidence:2,candidates:[110,55],algorithm:"PercivalBpmEstimator"});expect(result.status).toBe("half-double");expect(result.recommendedBpm).toBe(55);expect(result.needsConfirmation).toBe(true)});
 it("keeps disagreement visible instead of averaging unrelated tempos",()=>{const result=reconcileTempoEstimates(zirectTempo(55),{bpm:84,confidence:1,candidates:[84],algorithm:"PercivalBpmEstimator"});expect(result.status).toBe("conflict");expect(result.recommendedBpm).toBe(55);expect(result.message).toContain("chênh lệch rõ")});
 it("falls back to Zirect when Essentia is unavailable",()=>{const result=reconcileTempoEstimates(zirectTempo(55),undefined,"WASM failed");expect(result.status).toBe("zirect-only");expect(result.recommendedBpm).toBe(55);expect(result.essentiaError).toBe("WASM failed")});
});
