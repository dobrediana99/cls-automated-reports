import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadMonthlyEmployeePrompt, loadMonthlyDepartmentPrompt } from './loadPrompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('loadPrompts', () => {
  it('monthlyEmployeePrompt.md exists in repo', () => {
    const filePath = path.join(__dirname, 'monthlyEmployeePrompt.md');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('monthlyDepartmentPrompt.md exists in repo', () => {
    const filePath = path.join(__dirname, 'monthlyDepartmentPrompt.md');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('loadMonthlyEmployeePrompt returns non-empty string and contains key sections', () => {
    const content = loadMonthlyEmployeePrompt();
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toMatch(/Performance Manager|rolul|structura/i);
    expect(content).toMatch(/Tabel|Interpretare|Concluzii|Acțiuni|Plan/i);
  });

  it('loadMonthlyDepartmentPrompt returns non-empty string and contains key sections', () => {
    const content = loadMonthlyDepartmentPrompt();
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toMatch(/analist|executiv|management/i);
    expect(content).toMatch(/Rezumat executiv|Analiză|Comparații|Recomandări/i);
  });
});
