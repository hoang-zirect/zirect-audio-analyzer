import { describe, expect, it } from "vitest";
import { analyzeCompositionSamples, compareCompositions, downmixChannels, type CompositionAnalysis } from "./audio-composition";
const pulse=(seconds=12,sr=1000)=>{const a=new Float32Array(seconds*sr);for(let p=500;p<a.length;p+=500)for(let i=p;i<Math.min(p+20,a.length);i++)a[i]=.8;return a};
describe("audio composition analysis",()=>{
 it("downmixes every stereo channel",()=>expect(Array.from(downmixChannels([new Float32Array([1,-1]),new Float32Array([-1,1])]))).toEqual([0,0]));
 it("handles silence/onset-free audio without NaN",()=>{const r=analyzeCompositionSamples(new Float32Array(4000),1000);expect(r.bpm).toBe(0);expect(r.restPercent).toBe(100);expect(Number.isFinite(r.onsetDensity)).toBe(true)});
 it("detects rest and phrase boundaries",()=>{const a=pulse();a.fill(0,4000,6000);const r=analyzeCompositionSamples(a,1000);expect(r.longestRest).toBeGreaterThan(1.5);expect(r.averagePhraseLength).toBeGreaterThan(0)});
 it("compares normalized sections and ranks largest differences",()=>{const a=analyzeCompositionSamples(pulse(16),1000),b=analyzeCompositionSamples(pulse(32),1000);b.sections[0].onsetDensity=400;const c=compareCompositions(a,b);expect(c.rows).toHaveLength(8);expect(c.findings[0].rank).toBe(1);expect(c.findings.every((f,i)=>i===0||c.findings[i-1].score>=f.score)).toBe(true)});
});

const tempoSignal=(bpm:number, seconds=48, subdivision=false, rubato=false, sr=1000)=>{const data=new Float32Array(seconds*sr);let beat=0,index=0;while(beat<seconds){const eighth=60/bpm/2;const count=subdivision?2:1;for(let sub=0;sub<count;sub++){const at=beat+sub*eighth;const amplitude=sub===0?1:.34;const start=Math.round(at*sr);for(let i=0;i<35&&start+i<data.length;i++)data[start+i]+=amplitude*Math.exp(-i/10)}index++;beat+=60/bpm*(rubato?1+Math.sin(index*.8)*.055:1)}return data};
describe("robust musical tempo",()=>{
 it("chooses 55 BPM over eighth-note double time",()=>expect(analyzeCompositionSamples(tempoSignal(55,48,true),1000).bpm).toBeGreaterThanOrEqual(52));
 it("keeps mildly rubato 55 BPM in the 50–60 range",()=>expect(analyzeCompositionSamples(tempoSignal(55,55,true,true),1000).bpm).toBeGreaterThanOrEqual(50));
 it("preserves a genuine clear 120 BPM pulse",()=>expect(analyzeCompositionSamples(tempoSignal(120),1000).bpm).toBeGreaterThanOrEqual(116));
 it("returns unknown and Low confidence for silence",()=>{const r=analyzeCompositionSamples(new Float32Array(10000),1000);expect(r.bpm).toBe(0);expect(r.confidence.tempo).toBe("Low")});
 it("never reports High confidence below 60% stability",()=>{const r=analyzeCompositionSamples(tempoSignal(55,16,true,true),1000);if(r.tempoStability<60)expect(r.confidence.tempo).not.toBe("High")});
});
