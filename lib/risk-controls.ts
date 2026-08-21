export function minimumConfidenceForRisk(riskLevel: number) {
  const normalized = Math.max(0, Math.min(100, Math.round(riskLevel)));
  return Math.round(80 - normalized * 0.3);
}

export function riskLabel(riskLevel: number) {
  if (riskLevel <= 33) return "Conservative";
  if (riskLevel <= 66) return "Balanced";
  return "Aggressive";
}
