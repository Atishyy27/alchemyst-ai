export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
}

export function diffJson(prev: unknown, next: unknown, currentPath: string = ''): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  if (prev === next) {
    // Also handle NaN case
    if (Number.isNaN(prev as any) && Number.isNaN(next as any)) return diffs;
    return diffs;
  }

  const getType = (val: unknown) => {
    if (Array.isArray(val)) return 'array';
    if (val === null) return 'null';
    return typeof val;
  };

  const prevType = getType(prev);
  const nextType = getType(next);

  if (prevType !== nextType) {
    diffs.push({
      path: currentPath,
      kind: 'changed',
      oldValue: prev,
      newValue: next
    });
    return diffs;
  }

  if (prevType === 'object' && prev !== null) {
    const prevObj = prev as Record<string, unknown>;
    const nextObj = next as Record<string, unknown>;
    const prevKeys = Object.keys(prevObj);
    const nextKeys = Object.keys(nextObj);
    const allKeys = new Set([...prevKeys, ...nextKeys]);

    for (const key of allKeys) {
      const keyPath = currentPath ? `${currentPath}.${key}` : key;
      if (!prevKeys.includes(key)) {
        diffs.push({ path: keyPath, kind: 'added', newValue: nextObj[key] });
      } else if (!nextKeys.includes(key)) {
        diffs.push({ path: keyPath, kind: 'removed', oldValue: prevObj[key] });
      } else {
        diffs.push(...diffJson(prevObj[key], nextObj[key], keyPath));
      }
    }
  } else if (prevType === 'array') {
    const prevArr = prev as unknown[];
    const nextArr = next as unknown[];
    const maxLength = Math.max(prevArr.length, nextArr.length);

    for (let i = 0; i < maxLength; i++) {
      const keyPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
      if (i >= prevArr.length) {
        diffs.push({ path: keyPath, kind: 'added', newValue: nextArr[i] });
      } else if (i >= nextArr.length) {
        diffs.push({ path: keyPath, kind: 'removed', oldValue: prevArr[i] });
      } else {
        diffs.push(...diffJson(prevArr[i], nextArr[i], keyPath));
      }
    }
  } else {
    // Primitives
    if (prev !== next) {
      // In JS, NaN !== NaN, let's handle that case to avoid false positives
      if (Number.isNaN(prev as any) && Number.isNaN(next as any)) {
        return diffs;
      }
      diffs.push({ path: currentPath, kind: 'changed', oldValue: prev, newValue: next });
    }
  }

  return diffs;
}
