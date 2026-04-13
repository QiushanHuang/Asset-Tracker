import { describe, expect, it } from 'vitest';
import { bootstrapApp } from '../../src/app/bootstrap';

describe('bootstrapApp', () => {
  it('clears the target and appends the app shell', () => {
    const target = document.createElement('div');
    const staleNode = document.createElement('span');

    staleNode.textContent = 'stale';
    target.appendChild(staleNode);

    bootstrapApp(target);

    const shell = target.firstElementChild as HTMLElement | null;

    expect(target.childElementCount).toBe(1);
    expect(shell?.dataset.appShell).toBe('true');
    expect(target.querySelector('[data-role="boot-status"]')?.textContent).toContain('Loading local book');
    expect(target.textContent).not.toContain('stale');
  });
});
