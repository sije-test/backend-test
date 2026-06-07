export interface OrderFieldDescriptor {
  key: 'productName' | 'quantity' | 'unitPrice' | 'specs' | 'deliveryDate';
  /** approve 머지 시 changes 값을 DB 쓰기용 타입으로 변환 */
  fromChange: (v: unknown) => unknown;
  /** history 비교용 정규화 (Decimal→String, Date→ISO, 그 외→JSON.stringify) */
  serialize: (v: unknown) => string;
}

export const ORDER_FIELDS: readonly OrderFieldDescriptor[] = [
  {
    key: 'productName',
    fromChange: (v) => v,
    serialize: (v) => JSON.stringify(v),
  },
  {
    key: 'quantity',
    fromChange: (v) => v,
    serialize: (v) => JSON.stringify(v),
  },
  {
    key: 'unitPrice',
    fromChange: (v) => Number(v),
    serialize: (v) => String(v),
  },
  { key: 'specs', fromChange: (v) => v, serialize: (v) => JSON.stringify(v) },
  {
    key: 'deliveryDate',
    fromChange: (v) => new Date(v as string),
    serialize: (v) => (v instanceof Date ? v.toISOString() : String(v)),
  },
];

/** approve 경로에서 changes를 order에 머지한다. changes에 있는 필드만 fromChange로 변환 후 덮어쓴다. */
export function mergeChanges(
  order: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of ORDER_FIELDS) {
    result[field.key] =
      field.key in changes
        ? field.fromChange(changes[field.key])
        : order[field.key];
  }
  return result;
}

/** purchaseOrderVersion.create 데이터를 구성한다. ORDER_FIELDS의 key로 source에서 5필드를 추출하고 meta를 합친다. */
export function buildVersionData(
  source: Record<string, unknown>,
  meta: {
    orderId: number;
    version: number;
    changedBy: string;
    reason: string;
    changeRequestId: number | null;
  },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const f of ORDER_FIELDS) {
    fields[f.key] = source[f.key];
  }
  return { ...fields, ...meta };
}
