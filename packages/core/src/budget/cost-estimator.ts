export function estimateTokenCost(actionType: string): number {
  const norm = actionType.toLowerCase();
  
  if (norm.includes("refactor") || norm.includes("complex")) {
    return 35000;
  }
  if (norm.includes("architect") || norm.includes("decompose") || norm.includes("arbitrate")) {
    return 27500;
  }
  if (norm.includes("analyze") || norm.includes("impact") || norm.includes("spec")) {
    return 20000;
  }
  
  return 10000; // standard baseline estimate
}
