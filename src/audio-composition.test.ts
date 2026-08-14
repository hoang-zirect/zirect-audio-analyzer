import { describe, expect, it } from "vitest";
import { analyzeCompositionSamples, compareCompositions, downmixChannels, type CompositionAnalysis } from "./audio-composition";
const pulse=(seconds=12,sr=1000)=>{const a=new Float32Array(seconds*sr);for(let p=500;p<a.length;p+=500)for(let i=p;i<Math.min(p+20,a.length);i++)a[i]=.8;return a};
describe("audio composition analysis",()=>{
 it("downmixes every stereo channel",()=>expect(Array.from(downmixChannels([new Float32Array([1,-1]),new Float32Array([-1,1])]))).toEqual([0,0]));
 it("handles silence/onset-free audio without NaN",()=>{const r=analyzeCompositionSamples(new Float32Array(4000),1000);expect(r.bpm).toBe(0);expect(r.restPercent).toBe(100);expect(Number.isFinite(r.onsetDensity)).toBe(true)});
 it("detects rest and phrase boundaries",()=>{const a=pulse();a.fill(0,4000,6000);const r=analyzeCompositionSamples(a,1000);expect(r.longestRest).toBeGreaterThan(1.5);expect(r.averagePhraseLength).toBeGreaterThan(0)});
 it("compares normalized sections and ranks largest differences",()=>{const a=analyzeCompositionSamples(pulse(16),1000),b=analyzeCompositionSamples(pulse(32),1000);b.sections[0].onsetDensity=400;const c=compareCompositions(a,b);expect(c.rows).toHaveLength(8);expect(c.findings[0].rank).toBe(1);expect(c.findings.every((f,i)=>i===0||c.findings[i-1].score>=f.score)).toBe(true)});
});
