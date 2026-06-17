export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
}

export function diffJson(prev: unknown, next: unknown, currentPath: string = ''): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  diffJsonHelper(prev, next, currentPath, diffs);
  return diffs;
}

function diffJsonHelper(prev: unknown, next: unknown, currentPath: string, diffs: DiffEntry[]): void {
  if (prev === next) {
    return;
  }

  const isPrevArr = Array.isArray(prev);
  const isNextArr = Array.isArray(next);

  const prevType = prev === null ? 'null' : isPrevArr ? 'array' : typeof prev;
  const nextType = next === null ? 'null' : isNextArr ? 'array' : typeof next;

  if (prevType !== nextType) {
    diffs.push({
      path: currentPath,
      kind: 'changed',
      oldValue: prev,
      newValue: next
    });
    return;
  }

  if (prevType === 'object' && prev !== null) {
    const prevObj = prev as Record<string, unknown>;
    const nextObj = next as Record<string, unknown>;

    const nextKeys = Object.keys(nextObj);
    for (let i = 0; i < nextKeys.length; i++) {
      const key = nextKeys[i];
      if (!(key in prevObj)) {
        const keyPath = currentPath ? currentPath + '.' + key : key;
        diffs.push({ path: keyPath, kind: 'added', newValue: nextObj[key] });
      } else if (prevObj[key] !== nextObj[key]) {
        const keyPath = currentPath ? currentPath + '.' + key : key;
        diffJsonHelper(prevObj[key], nextObj[key], keyPath, diffs);
      }
    }

    const prevKeys = Object.keys(prevObj);
    for (let i = 0; i < prevKeys.length; i++) {
      const key = prevKeys[i];
      if (!(key in nextObj)) {
        const keyPath = currentPath ? currentPath + '.' + key : key;
        diffs.push({ path: keyPath, kind: 'removed', oldValue: prevObj[key] });
      }
    }
  } else if (isPrevArr) {
    const prevArr = prev as unknown[];
    const nextArr = next as unknown[];
    const maxLength = Math.max(prevArr.length, nextArr.length);

    for (let i = 0; i < maxLength; i++) {
      if (i >= prevArr.length) {
        const keyPath = currentPath ? currentPath + '[' + i + ']' : '[' + i + ']';
        diffs.push({ path: keyPath, kind: 'added', newValue: nextArr[i] });
      } else if (i >= nextArr.length) {
        const keyPath = currentPath ? currentPath + '[' + i + ']' : '[' + i + ']';
        diffs.push({ path: keyPath, kind: 'removed', oldValue: prevArr[i] });
      } else if (prevArr[i] !== nextArr[i]) {
        const keyPath = currentPath ? currentPath + '[' + i + ']' : '[' + i + ']';
        diffJsonHelper(prevArr[i], nextArr[i], keyPath, diffs);
      }
    }
  } else {
    // Primitives
    if (prev !== next) {
      if (typeof prev === 'number' && typeof next === 'number' && Number.isNaN(prev) && Number.isNaN(next)) {
        return;
      }
      diffs.push({ path: currentPath, kind: 'changed', oldValue: prev, newValue: next });
    }
  }
}
