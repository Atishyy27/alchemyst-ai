import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { JsonTree } from './JsonTree';
import React from 'react';

describe('JsonTree', () => {
  it('renders nested object, toggles node, and asserts children hide/show', () => {
    const data = {
      level1: {
        level2: {
          level3: {
            value: "hidden initially"
          }
        }
      }
    };

    render(<JsonTree data={data} />);

    // Check level1 key is visible
    expect(screen.getByText(/"level1":/)).toBeInTheDocument();
    
    // Check level2 key is NOT visible yet
    expect(screen.queryByText(/"level2":/)).not.toBeInTheDocument();

    // Now let's click the toggle for level1
    fireEvent.click(screen.getByTestId('toggle-level1'));

    // Check level2 key is visible
    expect(screen.getByText(/"level2":/)).toBeInTheDocument();

    // Now let's click the toggle for level2
    fireEvent.click(screen.getByTestId('toggle-level2'));

    // Check level3 key is visible
    expect(screen.getByText(/"level3":/)).toBeInTheDocument();

    // Check "hidden initially" is NOT in document, because level 3 is depth 3 (which is collapsed)
    expect(screen.queryByText(/"hidden initially"/)).not.toBeInTheDocument();

    // Now let's click the toggle for level3
    const toggleBtn = screen.getByTestId('toggle-level3');
    fireEvent.click(toggleBtn);

    // Now it should be visible
    expect(screen.getByText(/"hidden initially"/)).toBeInTheDocument();

    // Click again to hide
    fireEvent.click(toggleBtn);
    expect(screen.queryByText(/"hidden initially"/)).not.toBeInTheDocument();
  });
});
