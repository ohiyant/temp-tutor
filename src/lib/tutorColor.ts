// Small fixed palette, deterministically assigned per tutor so colors stay
// stable across requests and pages without persisting anything.
const PALETTE = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d"];

export function colorForTutor(tutorId: string): string {
  let hash = 0;
  for (let i = 0; i < tutorId.length; i++) hash = (hash * 31 + tutorId.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
