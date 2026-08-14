export type EssentiaTempoEstimate = {
  bpm: number;
  confidence?: number;
  candidates: number[];
};

type TempoResponse = { id: number; result?: EssentiaTempoEstimate; error?: string };
type PendingRequest = { resolve: (result: EssentiaTempoEstimate) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };

let worker: Worker | undefined;
let requestId = 0;
const pending = new Map<number, PendingRequest>();

function rejectPending(message: string) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(message));
  }
  pending.clear();
}

function resetWorker(message: string) {
  rejectPending(message);
  worker?.terminate();
  worker = undefined;
}

function getWorker() {
  if (typeof Worker === "undefined") throw new Error("Trình duyệt không hỗ trợ Web Worker cho Essentia.");
  if (!worker) {
    worker = new Worker(new URL("./essentia-tempo.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<TempoResponse>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      clearTimeout(request.timer);
      if (event.data.result) request.resolve(event.data.result);
      else request.reject(new Error(event.data.error ?? "Essentia không thể phân tích BPM."));
    };
    worker.onerror = () => {
      resetWorker("Không thể khởi động Essentia WebAssembly.");
    };
  }
  return worker;
}

/** Runs Essentia off the UI thread. The transferred samples must be mono 44.1 kHz and are consumed by this call. */
export function analyzeEssentiaTempo(samples: Float32Array): Promise<EssentiaTempoEstimate> {
  const id = ++requestId;
  const transferable = samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength ? samples : samples.slice();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      resetWorker("Essentia xử lý quá lâu; báo cáo đã chuyển sang bộ đo Zirect.");
    }, 120_000);
    pending.set(id, { resolve, reject, timer });
    try {
      getWorker().postMessage({ id, samples: transferable }, [transferable.buffer]);
    } catch (reason) {
      pending.delete(id);
      clearTimeout(timer);
      reject(reason instanceof Error ? reason : new Error("Không thể gửi audio tới Essentia."));
    }
  });
}
