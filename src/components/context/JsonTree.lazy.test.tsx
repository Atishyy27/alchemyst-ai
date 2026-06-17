import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { JsonTree } from './JsonTree';
import React from 'react';

describe('JsonTree Lazy Expansion', () => {
  it('mounts large object fast and without JSON.stringify', () => {
    // Generate a ~600KB object
    const largeObj: any = { arr: [] };
    // 10,000 items with strings, around 600KB+
    for (let i = 0; i < 15000; i++) {
      largeObj.arr.push({ id: i, value: "some somewhat long string to take up space in memory ".repeat(2) });
    }

    const stringifySpy = vi.spyOn(JSON, 'stringify');
    
    const start = performance.now();
    render(<JsonTree data={largeObj} />);
    const end = performance.now();

    expect(end - start).toBeLessThan(200);
    expect(stringifySpy).not.toHaveBeenCalled();

    // Verify it rendered with root expanded, but arr collapsed
    expect(screen.queryByText(/1 keys/)).not.toBeInTheDocument();
    
    // Now we should see the arr collapsed with 15000 items
    expect(screen.getByText(/15000 items/)).toBeInTheDocument();
    
    const toggleArr = screen.getByTestId('toggle-arr');
    fireEvent.click(toggleArr);

    // Should render only 25 items initially
    const loadMore = screen.getByTestId('load-more-arr');
    expect(loadMore).toBeInTheDocument();
    expect(loadMore.textContent).toContain('remaining');

    fireEvent.click(loadMore);
    // clicked load more, should now have 50 items visible (so remaining decreases by 25)
    expect(loadMore.textContent).toContain((15000 - 50).toString());
  });
});
