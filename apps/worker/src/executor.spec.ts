import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeRecipe, Recipe, Step } from './executor.js';
import * as playwright from 'playwright';
import path from 'path';

// Mock playwright
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn()
  }
}));

describe('Recipe Player Executor', () => {
  let mockBrowser: any;
  let mockContext: any;
  let mockPage: any;
  let mockLocator: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockLocator = {
      click: vi.fn(),
      fill: vi.fn(),
      waitFor: vi.fn(),
      textContent: vi.fn().mockResolvedValue('Mock Text'),
      evaluate: vi.fn().mockResolvedValue(true)
    };
    
    mockPage = {
      goto: vi.fn(),
      locator: vi.fn().mockReturnValue(mockLocator),
      getByRole: vi.fn().mockReturnValue(mockLocator),
      getByLabel: vi.fn().mockReturnValue(mockLocator),
      getByPlaceholder: vi.fn().mockReturnValue(mockLocator),
      getByTestId: vi.fn().mockReturnValue(mockLocator),
      route: vi.fn(),
      screenshot: vi.fn()
    };
    
    mockContext = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
      close: vi.fn()
    };
    
    mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn()
    };
    
    vi.mocked(playwright.chromium.launch).mockResolvedValue(mockBrowser);
  });

  const agent = { 
    site: 'https://example.com', 
    params: { origin: 'MUC', testParam: 'Hello' },
    result_schema: { type: 'object', properties: { field1: { type: 'string' } } }
  };

  it('(a) should substitute {{platzhalter}} correctly', async () => {
    const recipe: Recipe = {
      version: 1,
      steps: [
        { action: 'goto', url: 'https://example.com/?q={{origin}}' },
        { action: 'fill', selector: '#input', value: '{{testParam}} World' }
      ]
    };
    
    await executeRecipe(agent, recipe, 'run-123');
    
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/?q=MUC', expect.any(Object));
    expect(mockLocator.fill).toHaveBeenCalledWith('Hello World');
  });

  it('(b) should parse locator strings properly', async () => {
    const recipe: Recipe = {
      version: 1,
      steps: [
        { action: 'click', selector: 'getByRole("button", { name: "Submit" })' },
        { action: 'click', selector: 'getByLabel("First Name")' },
        { action: 'click', selector: 'getByPlaceholder("Search...")' },
        { action: 'click', selector: '.css-class' }
      ]
    };
    
    await executeRecipe(agent, recipe, 'run-124');
    
    expect(mockPage.getByRole).toHaveBeenCalledWith('button', { name: 'Submit', exact: true });
    expect(mockPage.getByLabel).toHaveBeenCalledWith('First Name');
    expect(mockPage.getByPlaceholder).toHaveBeenCalledWith('Search...');
    expect(mockPage.locator).toHaveBeenCalledWith('.css-class');
  });

  it('(c) should not fail the run if optional:true step fails', async () => {
    mockLocator.click.mockRejectedValueOnce(new Error('Timeout!'));
    
    const recipe: Recipe = {
      version: 1,
      steps: [
        { action: 'click', selector: '#accept-cookies', optional: true },
        { action: 'goto', url: 'https://example.com' }
      ]
    };
    
    const result = await executeRecipe(agent, recipe, 'run-125');
    
    expect(result.error).toBeUndefined(); // Run continues
    expect(result.stepsLog[0].error).toBe('Timeout!');
    expect(mockPage.goto).toHaveBeenCalled(); // Second step was reached
  });

  it('(d) should abort run if denylist button or password field is detected', async () => {
    mockLocator.evaluate.mockResolvedValueOnce(false); // Simulate guardrail block
    
    const recipe: Recipe = {
      version: 1,
      steps: [
        { action: 'click', selector: '#buy-button' }
      ]
    };
    
    const result = await executeRecipe(agent, recipe, 'run-126');
    
    expect(result.error).toMatch(/Guardrail blocked/);
    expect(mockLocator.click).not.toHaveBeenCalled();
  });

  it('(e) dom_map should extract successfully', async () => {
    const recipe: Recipe = {
      version: 1,
      steps: [
        { action: 'extract', mode: 'dom_map', map: { field1: '.price' } }
      ]
    };
    
    const result = await executeRecipe(agent, recipe, 'run-127');
    
    expect(result.error).toBeUndefined();
    expect(result.resultData).toEqual({ field1: 'Mock Text' });
    expect(mockPage.locator).toHaveBeenCalledWith('.price');
    expect(mockLocator.textContent).toHaveBeenCalled();
  });
});
