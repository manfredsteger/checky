import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import * as db from './db.js';

vi.mock('./db.js', () => ({
  query: vi.fn(),
}));

describe('API Routes Validation & Errors', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('Agent missing cron -> 400 Validation Error', async () => {
    const res = await request(app)
      .post('/api/projects/123e4567-e89b-12d3-a456-426614174000/agents')
      .send({
        name: 'Test Agent',
        site: 'https://example.com',
        goal_text: 'Finde den Preis',
        // schedule_cron is intentionally missing
      });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Validation error');
    expect(res.body.error).toContain('schedule_cron');
  });

  it('Unknown Project-ID -> 404', async () => {
    // Mock the project existence check query to return 0 rows
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: [] });

    const res = await request(app)
      .post('/api/projects/123e4567-e89b-12d3-a456-426614174000/agents')
      .send({
        name: 'Test Agent',
        site: 'https://example.com',
        goal_text: 'Finde den Preis',
        schedule_cron: '0 8 * * *',
      });
    
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Project not found');
  });

  it('Create valid Agent -> 201', async () => {
    // 1st query: Project check -> returns 1
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '123e4567-e89b-12d3-a456-426614174000' }], command: 'SELECT', oid: 0, fields: [] });
    // 2nd query: Insert Agent -> returns agent
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'agent-123' }], command: 'INSERT', oid: 0, fields: [] });

    const res = await request(app)
      .post('/api/projects/123e4567-e89b-12d3-a456-426614174000/agents')
      .send({
        name: 'Test Agent',
        site: 'https://example.com',
        goal_text: 'Finde den Preis',
        schedule_cron: '0 8 * * *',
      });
    
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('agent-123');
  });
});
