import React, { useState } from 'react';
import { DiffEntry } from '../../lib/diff/jsonDiff';

interface JsonTreeProps {
  data: any;
  depth?: number;
  name?: string;
  isLast?: boolean;
  diffs?: DiffEntry[];
  currentPath?: string;
}

const getParentPath = (path: string) => {
  const lastDot = path.lastIndexOf('.');
  const lastBracket = path.lastIndexOf('[');
  if (lastBracket > lastDot && lastBracket > 0) {
    return path.substring(0, lastBracket);
  }
  if (lastDot > 0) {
    return path.substring(0, lastDot);
  }
  return '';
};

const getKey = (path: string) => {
  const lastDot = path.lastIndexOf('.');
  const lastBracket = path.lastIndexOf('[');
  if (lastBracket > lastDot) {
    return path.substring(lastBracket + 1, path.length - 1);
  }
  if (lastDot >= 0) {
    return path.substring(lastDot + 1);
  }
  return path;
};

const cheapSizeEstimate = (obj: any, limit: number = 50000): number => {
  let size = 0;
  const queue = [obj];
  while (queue.length > 0 && size < limit) {
    const current = queue.pop();
    if (typeof current === 'string') size += current.length * 2;
    else if (typeof current === 'number') size += 8;
    else if (typeof current === 'boolean') size += 4;
    else if (current === null || current === undefined) size += 4;
    else if (Array.isArray(current)) {
      size += 20;
      for (let i = 0; i < current.length; i++) {
        queue.push(current[i]);
      }
    } else if (typeof current === 'object') {
      size += 20;
      for (const key in current) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          size += key.length * 2;
          queue.push(current[key]);
        }
      }
    }
  }
  return size;
};

export function JsonTree({ data, depth = 0, name, isLast = true, diffs = [], currentPath = '' }: JsonTreeProps) {
  const isObject = typeof data === 'object' && data !== null && !Array.isArray(data);
  const isArray = Array.isArray(data);
  const isComplex = isObject || isArray;

  const [initialExpanded] = useState(() => {
    if (!isComplex) return false;
    const childCount = isArray ? data.length : Object.keys(data).length;
    if (childCount > 50) return false;
    if (cheapSizeEstimate(data) > 25000) return false;
    return depth <= 2;
  });

  const [expanded, setExpanded] = useState(initialExpanded);
  const [visibleCount, setVisibleCount] = useState(25);

  const toggle = () => setExpanded(!expanded);

  const myDiff = diffs.find(d => d.path === currentPath && currentPath !== '');
  let bgColorClass = '';
  let lineThrough = false;

  if (myDiff) {
    if (myDiff.kind === 'added') bgColorClass = 'bg-green-100/50';
    if (myDiff.kind === 'changed') bgColorClass = 'bg-yellow-100/50';
    if (myDiff.kind === 'removed') {
      bgColorClass = 'bg-red-100/50 text-red-600 line-through';
      lineThrough = true;
    }
  }

  if (!isComplex) {
    let valueColor = lineThrough ? '' : 'text-green-600'; 
    let displayValue = String(data);
    if (typeof data === 'number') {
      valueColor = lineThrough ? '' : 'text-blue-600';
    } else if (typeof data === 'boolean') {
      valueColor = lineThrough ? '' : 'text-purple-600';
    } else if (data === null) {
      valueColor = lineThrough ? '' : 'text-gray-500';
      displayValue = 'null';
    } else if (data === undefined) {
      valueColor = lineThrough ? '' : 'text-gray-500';
      displayValue = 'undefined';
    } else if (typeof data === 'string') {
      displayValue = `"${data}"`;
    }

    return (
      <div className={`flex font-mono text-xs whitespace-pre rounded px-1 w-fit ${bgColorClass} ${lineThrough ? 'text-red-500 line-through' : ''}`}>
        {name && <span className="text-gray-700 mr-1">"{name}":</span>}
        <span className={valueColor}>{displayValue}</span>
        {!isLast && <span className="text-gray-600">,</span>}
      </div>
    );
  }

  let children: { key: string, val: any, childPath: string, isRemoved: boolean }[] = [];
  let childCount = 0;
  
  if (isArray) {
    childCount = (data as any[]).length;
    if (expanded) {
      children = (data as any[]).map((val, idx) => ({
        key: String(idx),
        val,
        childPath: currentPath ? `${currentPath}[${idx}]` : `[${idx}]`,
        isRemoved: false
      }));
    }
  } else {
    const keys = Object.keys(data as Record<string, any>);
    childCount = keys.length;
    if (expanded) {
      keys.forEach(key => {
        children.push({
          key,
          val: (data as any)[key],
          childPath: currentPath ? `${currentPath}.${key}` : key,
          isRemoved: false
        });
      });
    }
  }

  const removedDiffs = diffs.filter(d => d.kind === 'removed' && getParentPath(d.path) === currentPath);
  childCount += removedDiffs.length;

  if (expanded && removedDiffs.length > 0) {
    removedDiffs.forEach(d => {
      children.push({
        key: getKey(d.path),
        val: d.oldValue,
        childPath: d.path,
        isRemoved: true
      });
    });
    if (isArray) {
      children.sort((a, b) => parseInt(a.key) - parseInt(b.key));
    }
  }

  const isEmpty = childCount === 0;
  const bracketOpen = isArray ? '[' : '{';
  const bracketClose = isArray ? ']' : '}';

  if (isEmpty) {
    return (
      <div className={`flex font-mono text-xs whitespace-pre rounded px-1 w-fit ${bgColorClass}`}>
        {name && <span className="text-gray-700 mr-1">"{name}":</span>}
        <span className="text-gray-600">{bracketOpen}{bracketClose}</span>
        {!isLast && <span className="text-gray-600">,</span>}
      </div>
    );
  }

  return (
    <div className={`font-mono text-xs rounded ${bgColorClass} w-fit`}>
      <div className="flex items-center cursor-pointer select-none hover:bg-gray-100/50 w-fit pr-2 rounded px-1" onClick={toggle} data-testid={`toggle-${name || 'root'}`}>
        <span className="text-gray-400 mr-1 w-3 text-center inline-block">{expanded ? '▼' : '▶'}</span>
        {name && <span className={`mr-1 ${lineThrough ? 'text-red-500 line-through' : 'text-gray-700'}`}>"{name}":</span>}
        <span className="text-gray-600">{bracketOpen}</span>
        {!expanded && (
          <span className="text-gray-400 mx-1">
            {isArray ? `${childCount} items` : `${childCount} keys`}
          </span>
        )}
        {!expanded && <span className="text-gray-600">{bracketClose}</span>}
        {!expanded && !isLast && <span className="text-gray-600">,</span>}
      </div>

      {expanded && (
        <div className="pl-4 border-l border-gray-200 ml-1.5 my-0.5">
          {children.slice(0, isArray ? visibleCount : undefined).map((child, idx) => (
             <JsonTree 
               key={child.key} 
               data={child.val} 
               name={isArray ? undefined : child.key}
               depth={depth + 1} 
               isLast={idx === (isArray ? Math.min(children.length, visibleCount) : children.length) - 1} 
               diffs={diffs}
               currentPath={child.childPath}
             />
          ))}
          {isArray && visibleCount < children.length && (
            <div 
              className="text-blue-500 cursor-pointer hover:underline text-xs py-1"
              onClick={() => setVisibleCount(v => v + 25)}
              data-testid={`load-more${name ? `-${name}` : ''}`}
            >
              Load more... ({children.length - visibleCount} remaining)
            </div>
          )}
        </div>
      )}
      {expanded && (
        <div className="flex pl-1">
          <span className="text-gray-600">{bracketClose}</span>
          {!isLast && <span className="text-gray-600">,</span>}
        </div>
      )}
    </div>
  );
}


