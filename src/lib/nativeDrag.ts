export type NativeDragKind = 'meal-time' | 'dish' | 'ingredient';

export const beginNativeDrag = (
  dataTransfer: DataTransfer,
  kind: NativeDragKind,
  payload: unknown,
) => {
  const serialized = JSON.stringify(payload);
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(`application/x-norder-${kind}`, serialized);
  // Safari y algunos motores Chromium necesitan un payload text/plain para
  // completar de forma confiable el ciclo dragstart -> drop -> dragend.
  dataTransfer.setData('text/plain', serialized);
};
