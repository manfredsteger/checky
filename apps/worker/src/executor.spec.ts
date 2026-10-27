import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeRecipe, parseGermanNumber, Recipe, Step } from './executor.js';
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
      count: vi.fn().mockResolvedValue(1),
      getAttribute: vi.fn().mockResolvedValue(null),
      pressSequentially: vi.fn(),
      press: vi.fn(),
      textContent: vi.fn().mockResolvedValue('Mock Text'),
      innerText: vi.fn().mockResolvedValue('Mock Text'),
      ariaSnapshot: vi.fn().mockResolvedValue(''),
      evaluate: vi.fn().mockResolvedValue(true)
    };
    // first()/nth() liefern denselben Mock zurück — der Executor kettet darauf.
    mockLocator.first = vi.fn().mockReturnValue(mockLocator);
    mockLocator.nth = vi.fn().mockReturnValue(mockLocator);
    
    mockPage = {
      goto: vi.fn(),
      locator: vi.fn().mockReturnValue(mockLocator),
      getByRole: vi.fn().mockReturnValue(mockLocator),
      getByLabel: vi.fn().mockReturnValue(mockLocator),
      getByPlaceholder: vi.fn().mockReturnValue(mockLocator),
      getByTestId: vi.fn().mockReturnValue(mockLocator),
      route: vi.fn(),
      on: vi.fn(),
      mainFrame: vi.fn(),
      screenshot: vi.fn(),
      waitForTimeout: vi.fn(),
      keyboard: { press: vi.fn(), type: vi.fn() },
      evaluate: vi.fn().mockResolvedValue(undefined),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(),
      context: vi.fn(),
      url: vi.fn().mockReturnValue('https://example.com/ergebnis')
    };
    
    mockContext = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
      // Tarn-Schicht: Init-Skript + CDP-Sitzung für die Client Hints.
      addInitScript: vi.fn(),
      newCDPSession: vi.fn().mockResolvedValue({ send: vi.fn(), detach: vi.fn() }),
      cookies: vi.fn().mockResolvedValue([]),
      close: vi.fn()
    };
    mockPage.context.mockReturnValue(mockContext);

    mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      version: vi.fn().mockReturnValue('151.0.7922.34'),
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
    // fill() leert nur; der Wert wird per echten Tastenanschlägen eingegeben,
    // damit Autocomplete-Listen überhaupt aufgehen.
    expect(mockLocator.fill).toHaveBeenCalledWith('');
    expect(mockLocator.pressSequentially).toHaveBeenCalledWith('Hello World', expect.any(Object));
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
    expect(result.resultData).toEqual({ field1: 'Mock Text', _url: 'https://example.com/ergebnis' });
    expect(mockPage.locator).toHaveBeenCalledWith('.price');
    expect(mockLocator.textContent).toHaveBeenCalled();
  });
});

describe('parseGermanNumber', () => {
  const cases: Array<[string, number | null]> = [
    ['911.16', 911.16],            // englische Dezimalschreibweise (Ypsilon/LCC)
    ['3487.48 ', 3487.48],
    ['1023.32', 1023.32],
    ['1.175 €', 1175],             // deutscher Tausenderpunkt
    ['3.364,94 €', 3364.94],
    ['841,24 € pro Person', 841.24],
    ['889 € /Person', 889],
    ['1.094,64 € pro Person', 1094.64],
    ['134,20', 134.2],
    ['Ab 4.207 €', 4207],
    ['kein Preis', null],
  ];
  for (const [input, expected] of cases) {
    it(`liest "${input}" als ${expected}`, () => {
      expect(parseGermanNumber(input)).toBe(expected);
    });
  }
});
