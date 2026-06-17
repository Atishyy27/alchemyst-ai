import React, { useState } from 'react';
import { DiffEntry } from '../../lib/diff/jsonDiff';

interface JsonTreeProps {
  data: unknown;
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


export function JsonTree({ data, depth = 0, name, isLast = true, diffs = [], currentPath = '' }: JsonTreeProps) {
  const isObject = typeof data === 'object' && data !== null && !Array.isArray(data);
  const isArray = Array.isArray(data);
  const isComplex = isObject || isArray;

  const [initialExpanded] = useState(() => {
    if (!isComplex) return false;
    const childCount = isArray ? data.length : Object.keys(data).length;
    if (childCount > 50) return false;
    return depth === 0;
  });

  const [expanded, setExpanded] = useState(initialExpanded);
  const [visibleCount, setVisibleCount] = useState(25);

  const toggle = () => setExpanded(!expanded);

  const myDiff = diffs.find(d => d.path === currentPath && currentPath !== '');
  let bgColorClass = '';
  let lineThrough = false;
  let prefix = <span className="inline-block w-4 text-center mr-1 text-transparent select-none"> </span>;

  if (myDiff) {
    if (myDiff.kind === 'added') {
      bgColorClass = 'bg-emerald-500/15 text-emerald-900 rounded-sm -ml-5 pl-5 pr-1 my-0.5';
      prefix = <span className="inline-block w-4 text-center mr-1 text-emerald-600 font-bold select-none -ml-4">+</span>;
    }
    if (myDiff.kind === 'changed') {
      bgColorClass = 'bg-amber-500/15 text-amber-900 rounded-sm -ml-5 pl-5 pr-1 my-0.5';
      prefix = <span className="inline-block w-4 text-center mr-1 text-amber-600 font-bold select-none -ml-4">~</span>;
    }
    if (myDiff.kind === 'removed') {
      bgColorClass = 'bg-rose-500/15 text-rose-800 line-through rounded-sm -ml-5 pl-5 pr-1 my-0.5 opacity-80';
      prefix = <span className="inline-block w-4 text-center mr-1 text-rose-600 font-bold select-none no-underline -ml-4">-</span>;
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
      valueColor = lineThrough ? '' : 'text-slate-500';
      displayValue = 'null';
    } else if (data === undefined) {
      valueColor = lineThrough ? '' : 'text-slate-500';
      displayValue = 'undefined';
    } else if (typeof data === 'string') {
      displayValue = `"${data}"`;
    }

    return (
      <div className={`flex font-mono text-[12px] leading-5 whitespace-pre rounded px-1 w-full ${bgColorClass} ${lineThrough ? 'text-red-500 line-through' : ''}`}>
        {prefix}
        <div className="flex">
          {name && <span className="text-slate-700 mr-1">"{name}":</span>}
          <span className={valueColor}>{displayValue}</span>
          {!isLast && <span className="text-slate-500">,</span>}
        </div>
      </div>
    );
  }

  let children: { key: string, val: unknown, childPath: string, isRemoved: boolean }[] = [];
  let childCount = 0;
  
  if (isArray) {
    childCount = (data as unknown[]).length;
    if (expanded) {
      children = (data as unknown[]).map((val, idx) => ({
        key: String(idx),
        val,
        childPath: currentPath ? `${currentPath}[${idx}]` : `[${idx}]`,
        isRemoved: false
      }));
    }
  } else {
    const keys = Object.keys(data as Record<string, unknown>);
    childCount = keys.length;
    if (expanded) {
      keys.forEach(key => {
        children.push({
          key,
          val: (data as Record<string, unknown>)[key],
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
      <div className={`flex font-mono text-[12px] leading-5 whitespace-pre rounded px-1 w-full ${bgColorClass}`}>
        {prefix}
        <div className="flex">
          {name && <span className="text-slate-700 mr-1">"{name}":</span>}
          <span className="text-slate-500">{bracketOpen}{bracketClose}</span>
          {!isLast && <span className="text-slate-500">,</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`font-mono text-[12px] leading-5 rounded ${bgColorClass} w-full`}>
      <div className="flex items-center cursor-pointer select-none hover:bg-slate-100/50 w-full pr-2 rounded px-1" onClick={toggle} data-testid={`toggle-${name || 'root'}`}>
        {prefix}
        <span className="text-slate-400 mr-1 w-3 text-center inline-block">{expanded ? '▼' : '▶'}</span>
        {name && <span className={`mr-1 ${lineThrough ? 'text-rose-500 line-through' : 'text-slate-700'}`}>"{name}":</span>}
        <span className="text-slate-600">{bracketOpen}</span>
        {!expanded && (
          <span className="text-slate-400 mx-1">
            {isArray ? `${childCount} items` : `${childCount} keys`}
          </span>
        )}
        {!expanded && <span className="text-slate-600">{bracketClose}</span>}
        {!expanded && !isLast && <span className="text-slate-600">,</span>}
      </div>

      {expanded && (
        <div className="pl-4 border-l border-slate-300 hover:border-slate-400 transition-colors ml-1.5 my-0.5">
          {children.slice(0, visibleCount).map((child, idx) => (
             <JsonTree 
               key={child.key} 
               data={child.val} 
               name={isArray ? undefined : child.key}
               depth={depth + 1} 
               isLast={idx === Math.min(children.length, visibleCount) - 1} 
               diffs={diffs}
               currentPath={child.childPath}
             />
          ))}
          {visibleCount < children.length && (
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
          <span className="inline-block w-4 text-center mr-1 text-transparent select-none"> </span>
          <span className="text-slate-600 ml-4">{bracketClose}</span>
          {!isLast && <span className="text-slate-600">,</span>}
        </div>
      )}
    </div>
  );
}


